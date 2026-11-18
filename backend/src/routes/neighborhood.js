import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { findUserById, findUsersByPincode } from "../models/User.js";
import { createMessage, listConversation } from "../models/ChatMessage.js";
import {
  acceptConnection,
  createConnectionRequest,
  listConnectionsForUser,
} from "../models/Connection.js";
import { rateLimit } from "express-rate-limit";

const router = Router();
const messageRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "You’re sending messages too quickly. Please wait a moment." },
});

function publicNeighbor(user, hasFullVisibility) {
  return {
    id: user.id,
    name: hasFullVisibility ? user.name : "Private neighbor",
    nameVisible: hasFullVisibility,
    address: hasFullVisibility ? user.address : null,
    profilePhotoUrl:
      hasFullVisibility && user.profilePhoto
        ? `/api/auth/profile-photo/${user.id}?v=${encodeURIComponent(user.profilePhoto)}`
        : null,
    job: user.job,
    workplace: user.workplace,
    interests: user.interests,
  };
}

function normalizeSearchText(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

function searchScore(user, query) {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  const name = normalizeSearchText(user.name || "");
  const searchableFields = [
    name,
    normalizeSearchText(user.job || ""),
    normalizeSearchText(user.workplace || ""),
    ...(user.interests || []).map(normalizeSearchText),
  ];
  if (!terms.every((term) => searchableFields.some((field) => field.includes(term)))) return -1;
  if (terms.length === 1 && name === terms[0]) return 3;
  if (terms.length === 1 && name.startsWith(terms[0])) return 2;
  return 1;
}

function connectionForPerson(connections, viewerId, personId) {
  return connections.find(
    (connection) =>
      connection.status === "accepted" &&
      ((connection.requesterId === viewerId && connection.recipientId === personId) ||
        (connection.requesterId === personId && connection.recipientId === viewerId)),
  ) ?? connections.find(
    (connection) =>
      (connection.requesterId === viewerId && connection.recipientId === personId) ||
      (connection.requesterId === personId && connection.recipientId === viewerId),
  );
}

function canSeeFullProfile(user, connection) {
  const visibility = user.visibility || "connections";
  return visibility === "public" || (visibility === "connections" && connection?.status === "accepted");
}

function searchPeople(people, query) {
  const trimmedQuery = typeof query === "string" ? query.trim().slice(0, 120) : "";
  if (!trimmedQuery) return people;
  return people
    .map((person) => ({ person, score: searchScore(person, trimmedQuery) }))
    .filter(({ score }) => score >= 0)
    .sort((left, right) => right.score - left.score || left.person.id.localeCompare(right.person.id))
    .map(({ person }) => person);
}

function publicMessage(message) {
  return {
    id: message.id,
    senderId: message.senderId,
    recipientId: message.recipientId,
    content: message.content,
    createdAt: message.createdAt,
  };
}

async function getSameAreaPair(currentUserId, otherUserId) {
  if (!otherUserId || currentUserId === otherUserId) return null;
  const [currentUser, otherUser] = await Promise.all([
    findUserById(currentUserId),
    findUserById(otherUserId),
  ]);
  if (!currentUser || !otherUser || currentUser.pincode.trim().toUpperCase() !== otherUser.pincode.trim().toUpperCase()) {
    return null;
  }
  return { currentUser, otherUser };
}

router.get("/people", requireAuth, async (request, response, next) => {
  try {
    const user = await findUserById(request.userId);
    if (!user) return response.status(401).json({ error: "Please sign in again." });
    const [allPeople, connections] = await Promise.all([
      findUsersByPincode(user.pincode, user.id),
      listConnectionsForUser(user.id),
    ]);
    const people = searchPeople(allPeople, request.query.search).slice(0, 100);
    return response.json({
      people: people.map((person) =>
        publicNeighbor(
          person,
          canSeeFullProfile(person, connectionForPerson(connections, user.id, person.id)),
        ),
      ),
      pincode: user.pincode,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/connections", requireAuth, async (request, response, next) => {
  try {
    const [user, connections] = await Promise.all([
      findUserById(request.userId),
      listConnectionsForUser(request.userId),
    ]);
    if (!user) return response.status(401).json({ error: "Please sign in again." });

    const allPeople = await findUsersByPincode(user.pincode, user.id);
    const people = searchPeople(allPeople, request.query.search).slice(0, 100);
    const connectionByPersonId = new Map();
    for (const connection of connections) {
      const personId =
        connection.requesterId === request.userId
          ? connection.recipientId
          : connection.requesterId;
      const current = connectionByPersonId.get(personId);
      if (current?.connection.status === "accepted") continue;
      const status =
        connection.status === "accepted"
          ? "connected"
          : connection.recipientId === request.userId
            ? "incoming"
            : "sent";
      connectionByPersonId.set(personId, { status, connection });
    }

    return response.json({
      people: people.map((person) => {
        const state = connectionByPersonId.get(person.id);
        return {
          ...publicNeighbor(
            person,
            canSeeFullProfile(person, state?.connection),
          ),
          connectionStatus: state?.status || "none",
        };
      }),
      pendingCount: connections.filter(
        (connection) =>
          connection.status === "pending" && connection.recipientId === request.userId,
      ).length,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/connections/:userId", requireAuth, async (request, response, next) => {
  try {
    const pair = await getSameAreaPair(request.userId, request.params.userId);
    if (!pair) return response.status(404).json({ error: "That person isn’t available in your area." });
    const connection = await createConnectionRequest(request.userId, pair.otherUser.id);
    const status =
      connection.status === "accepted"
        ? "connected"
        : connection.requesterId === request.userId
          ? "sent"
          : "incoming";
    request.app.get("io")?.to(`user:${pair.otherUser.id}`).emit("connection:update", { connectionStatus: "incoming" });
    return response.status(connection.requesterId === request.userId ? 201 : 200).json({
      connectionStatus: status,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/connections/:userId/accept", requireAuth, async (request, response, next) => {
  try {
    const pair = await getSameAreaPair(request.userId, request.params.userId);
    if (!pair) return response.status(404).json({ error: "That person isn’t available in your area." });
    const connection = await acceptConnection(pair.otherUser.id, request.userId);
    if (!connection) return response.status(404).json({ error: "No connection request was found." });
    request.app.get("io")?.to(`user:${pair.otherUser.id}`).emit("connection:update", { connectionStatus: "connected" });
    return response.json({ connectionStatus: "connected" });
  } catch (error) {
    return next(error);
  }
});

router.get("/messages/:userId", requireAuth, async (request, response, next) => {
  try {
    const pair = await getSameAreaPair(request.userId, request.params.userId);
    if (!pair) return response.status(404).json({ error: "That neighbor isn’t available in your area." });
    const messages = await listConversation(pair.currentUser.id, pair.otherUser.id);
    return response.json({ messages: messages.map(publicMessage) });
  } catch (error) {
    return next(error);
  }
});

router.post("/messages/:userId", requireAuth, messageRateLimit, async (request, response, next) => {
  const content = typeof request.body?.content === "string" ? request.body.content.trim() : "";
  if (!content || content.length > 2000) {
    return response.status(400).json({ error: "Messages must be between 1 and 2,000 characters." });
  }

  try {
    const pair = await getSameAreaPair(request.userId, request.params.userId);
    if (!pair) return response.status(404).json({ error: "That neighbor isn’t available in your area." });
    const message = await createMessage({
      senderId: pair.currentUser.id,
      recipientId: pair.otherUser.id,
      content,
    });
    const publicMessageValue = publicMessage(message);
    const room = `conversation:${[pair.currentUser.id, pair.otherUser.id].sort().join(":")}`;
    request.app.get("io")?.to(room).emit("chat:message", publicMessageValue);
    return response.status(201).json({ message: publicMessageValue });
  } catch (error) {
    return next(error);
  }
});

export default router;
