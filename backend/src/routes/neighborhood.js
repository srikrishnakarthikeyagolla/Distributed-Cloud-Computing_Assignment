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
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  findBusinessById,
  findBusinessesByPincode,
} from "../models/Business.js";
import {
  createBusinessMessage,
  listBusinessConversation,
  listBusinessMessagesForUser,
} from "../models/BusinessMessage.js";
import {
  addBusinessDealMessage,
  createBusinessDeal,
  findBusinessDealById,
  listBusinessDeals,
  listBusinessDealsForUser,
  updateBusinessDealStatus,
} from "../models/BusinessDeal.js";

const router = Router();
const businessPhotoDirectory = fileURLToPath(new URL("../../data/business-photos/", import.meta.url));
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

function publicBusinessListing(business) {
  return {
    id: business.id,
    businessName: business.businessName,
    category: business.category,
    phone: business.phone,
    pincode: business.pincode,
    address: business.address,
    description: business.description,
    services: business.services,
    openingHours: business.openingHours,
    website: business.website,
    photos: (business.photos || []).map((fileName) => `/api/neighborhood/businesses/${business.id}/photos/${encodeURIComponent(fileName)}`),
  };
}

function publicBusinessMessage(message) {
  return {
    id: message.id,
    userId: message.userId,
    businessId: message.businessId,
    senderType: message.senderType,
    content: message.content,
    createdAt: message.createdAt,
  };
}

function emitBusinessDealUpdate(request, deal) {
  request.app.get("io")
    ?.to(`business-conversation:${deal.userId}:${deal.businessId}`)
    .to(`user:${deal.userId}`)
    .to(`business:${deal.businessId}`)
    .emit("business-deal:update", deal);
}

function validateDealProposal(input) {
  const proposal = typeof input === "string" ? input.trim() : "";
  if (!proposal || proposal.length > 2000) {
    return { error: "Describe the proposed deal in 1 to 2,000 characters." };
  }
  return { proposal };
}

function businessSearchScore(business, query) {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  const searchableFields = [
    business.businessName,
    business.category,
    business.description,
    ...(business.services || []),
  ].map((value) => normalizeSearchText(value || ""));
  if (!terms.every((term) => searchableFields.some((field) => field.includes(term)))) return -1;
  const name = normalizeSearchText(business.businessName);
  if (terms.length === 1 && name === terms[0]) return 3;
  if (terms.length === 1 && name.startsWith(terms[0])) return 2;
  return 1;
}

async function getBusinessForUser(userId, businessId) {
  const [user, business] = await Promise.all([
    findUserById(userId),
    findBusinessById(businessId),
  ]);
  if (
    !user ||
    !business ||
    user.pincode.trim().toUpperCase() !== business.pincode.trim().toUpperCase()
  ) return null;
  return { user, business };
}

router.get("/businesses", requireAuth, async (request, response, next) => {
  try {
    const user = await findUserById(request.userId);
    if (!user) return response.status(401).json({ error: "Please sign in again." });
    const businesses = await findBusinessesByPincode(user.pincode);
    const query = typeof request.query.search === "string" ? request.query.search.trim().slice(0, 120) : "";
    return response.json({
      businesses: businesses
        .map((business) => ({ business, score: businessSearchScore(business, query) }))
        .filter(({ score }) => score >= 0)
        .sort((left, right) => right.score - left.score || left.business.businessName.localeCompare(right.business.businessName))
        .slice(0, 100)
        .map(({ business }) => publicBusinessListing(business)),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/deals/active", requireAuth, async (request, response, next) => {
  try {
    const deals = (await listBusinessDealsForUser(request.userId))
      .filter((deal) => deal.status === "pending" || deal.status === "accepted")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const activeDeals = await Promise.all(deals.map(async (deal) => {
      const business = await findBusinessById(deal.businessId);
      return business
        ? { ...deal, business: publicBusinessListing(business) }
        : null;
    }));
    return response.json({ deals: activeDeals.filter(Boolean) });
  } catch (error) {
    return next(error);
  }
});

router.get("/businesses/:businessId/deals", requireAuth, async (request, response, next) => {
  try {
    const pair = await getBusinessForUser(request.userId, request.params.businessId);
    if (!pair) return response.status(404).json({ error: "That business is not available in your area." });
    const [deals, messages] = await Promise.all([
      listBusinessDeals(pair.user.id, pair.business.id),
      listBusinessConversation(pair.user.id, pair.business.id),
    ]);
    if (pair.business.isVisible === false && deals.length === 0 && messages.length === 0) {
      return response.status(404).json({ error: "That business is not accepting new conversations." });
    }
    return response.json({ deals });
  } catch (error) {
    return next(error);
  }
});

router.post("/businesses/:businessId/deals", requireAuth, messageRateLimit, async (request, response, next) => {
  const result = validateDealProposal(request.body?.proposal);
  if (result.error) return response.status(400).json({ error: result.error });
  try {
    const pair = await getBusinessForUser(request.userId, request.params.businessId);
    if (!pair) return response.status(404).json({ error: "That business is not available in your area." });
    if (pair.business.isVisible === false) {
      const [deals, messages] = await Promise.all([
        listBusinessDeals(pair.user.id, pair.business.id),
        listBusinessConversation(pair.user.id, pair.business.id),
      ]);
      if (deals.length === 0 && messages.length === 0) {
        return response.status(404).json({ error: "That business is not accepting new conversations." });
      }
    }
    const deal = await createBusinessDeal({
      userId: pair.user.id,
      businessId: pair.business.id,
      creatorType: "user",
      proposal: result.proposal,
    });
    emitBusinessDealUpdate(request, deal);
    return response.status(201).json({ deal });
  } catch (error) {
    return next(error);
  }
});

router.post("/deals/:dealId/status", requireAuth, async (request, response, next) => {
  const action = request.body?.action;
  if (!["accept", "pass", "fulfill"].includes(action)) {
    return response.status(400).json({ error: "Choose an available deal action." });
  }
  try {
    const deal = await findBusinessDealById(request.params.dealId);
    const business = deal ? await findBusinessById(deal.businessId) : null;
    const user = deal?.userId === request.userId ? await findUserById(request.userId) : null;
    if (
      !deal ||
      deal.userId !== request.userId ||
      !business ||
      !user ||
      user.pincode.trim().toUpperCase() !== business.pincode.trim().toUpperCase()
    ) {
      return response.status(404).json({ error: "That deal could not be found." });
    }
    if (action === "accept" || action === "pass") {
      if (deal.status !== "pending" || deal.creatorType === "user") {
        return response.status(409).json({ error: "This proposal is no longer awaiting your response." });
      }
    } else if (deal.status !== "accepted") {
      return response.status(409).json({ error: "Only an accepted deal can be marked fulfilled." });
    }
    const updatedDeal = await updateBusinessDealStatus(deal.id, action, "user");
    if (!updatedDeal) return response.status(409).json({ error: "This deal has already changed and can no longer be updated." });
    emitBusinessDealUpdate(request, updatedDeal);
    return response.json({ deal: updatedDeal });
  } catch (error) {
    return next(error);
  }
});

router.post("/deals/:dealId/messages", requireAuth, messageRateLimit, async (request, response, next) => {
  const content = typeof request.body?.content === "string" ? request.body.content.trim() : "";
  if (!content || content.length > 2000) {
    return response.status(400).json({ error: "Messages must be between 1 and 2,000 characters." });
  }
  try {
    const deal = await findBusinessDealById(request.params.dealId);
    const [user, business] = deal?.userId === request.userId
      ? await Promise.all([findUserById(request.userId), findBusinessById(deal.businessId)])
      : [null, null];
    if (
      !deal ||
      deal.userId !== request.userId ||
      !user ||
      !business ||
      user.pincode.trim().toUpperCase() !== business.pincode.trim().toUpperCase()
    ) return response.status(404).json({ error: "That deal could not be found." });
    const { message, deal: updatedDeal } = await addBusinessDealMessage(deal.id, "user", content) || {};
    if (!message) return response.status(409).json({ error: "Deal chat is available after the proposal is accepted." });
    emitBusinessDealUpdate(request, updatedDeal);
    return response.status(201).json({ message, deal: updatedDeal });
  } catch (error) {
    return next(error);
  }
});

router.get("/business-chats", requireAuth, async (request, response, next) => {
  try {
    const messages = await listBusinessMessagesForUser(request.userId);
    const deals = await listBusinessDealsForUser(request.userId);
    const latestByBusiness = new Map();
    for (const message of messages) {
      const current = latestByBusiness.get(message.businessId);
      if (!current || current.createdAt < message.createdAt) latestByBusiness.set(message.businessId, message);
    }
    for (const deal of deals) {
      const current = latestByBusiness.get(deal.businessId);
      if (!current || current.createdAt < deal.updatedAt) {
        latestByBusiness.set(deal.businessId, {
          businessId: deal.businessId,
          content: deal.messages.at(-1)?.content || deal.proposal,
          createdAt: deal.updatedAt,
          type: "deal",
        });
      }
    }
    const results = await Promise.all(
      [...latestByBusiness].map(async ([businessId, lastMessage]) => {
        const business = await findBusinessById(businessId);
        if (!business) return null;
        return {
          business: publicBusinessListing(business),
          lastMessage: lastMessage.id ? publicBusinessMessage(lastMessage) : lastMessage,
        };
      }),
    );
    return response.json({
      conversations: results.filter(Boolean).sort(
        (left, right) => right.lastMessage.createdAt.localeCompare(left.lastMessage.createdAt),
      ),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/businesses/:businessId/messages", requireAuth, async (request, response, next) => {
  try {
    const pair = await getBusinessForUser(request.userId, request.params.businessId);
    if (!pair) return response.status(404).json({ error: "That business is not available in your area." });
    const messages = await listBusinessConversation(pair.user.id, pair.business.id);
    const deals = await listBusinessDeals(pair.user.id, pair.business.id);
    if (pair.business.isVisible === false && messages.length === 0 && deals.length === 0) {
      return response.status(404).json({ error: "That business is not accepting new chats." });
    }
    return response.json({ messages: messages.map(publicBusinessMessage) });
  } catch (error) {
    return next(error);
  }
});

router.post("/businesses/:businessId/messages", requireAuth, messageRateLimit, async (request, response, next) => {
  const content = typeof request.body?.content === "string" ? request.body.content.trim() : "";
  if (!content || content.length > 2000) {
    return response.status(400).json({ error: "Messages must be between 1 and 2,000 characters." });
  }
  try {
    const pair = await getBusinessForUser(request.userId, request.params.businessId);
    if (!pair) return response.status(404).json({ error: "That business is not available in your area." });
    if (pair.business.isVisible === false) {
      const [existingMessages, existingDeals] = await Promise.all([
        listBusinessConversation(pair.user.id, pair.business.id),
        listBusinessDeals(pair.user.id, pair.business.id),
      ]);
      if (existingMessages.length === 0 && existingDeals.length === 0) {
        return response.status(404).json({ error: "That business is not accepting new chats." });
      }
    }
    const message = await createBusinessMessage({
      userId: pair.user.id,
      businessId: pair.business.id,
      senderType: "user",
      content,
    });
    const publicMessageValue = publicBusinessMessage(message);
    request.app.get("io")
      ?.to(`business-conversation:${pair.user.id}:${pair.business.id}`)
      .to(`user:${pair.user.id}`)
      .to(`business:${pair.business.id}`)
      .emit("business-chat:message", publicMessageValue);
    return response.status(201).json({ message: publicMessageValue });
  } catch (error) {
    return next(error);
  }
});

router.get("/businesses/:businessId/photos/:fileName", requireAuth, async (request, response, next) => {
  try {
    const pair = await getBusinessForUser(request.userId, request.params.businessId);
    const fileName = request.params.fileName;
    const hasExistingConversation = pair
      ? (await Promise.all([
        listBusinessConversation(pair.user.id, pair.business.id),
        listBusinessDeals(pair.user.id, pair.business.id),
      ])).some((items) => items.length > 0)
      : false;
    if (
      !pair ||
      (pair.business.isVisible === false && !hasExistingConversation) ||
      !(pair.business.photos || []).includes(fileName) ||
      !/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(fileName)
    ) return response.status(404).json({ error: "Business photo not found." });
    const mimeType = fileName.endsWith(".png") ? "image/png" : fileName.endsWith(".webp") ? "image/webp" : "image/jpeg";
    const photo = await readFile(join(businessPhotoDirectory, fileName));
    return response.type(mimeType).set("X-Content-Type-Options", "nosniff").set("Cache-Control", "private, no-store").send(photo);
  } catch (error) {
    if (error.code === "ENOENT") return response.status(404).json({ error: "Business photo not found." });
    return next(error);
  }
});

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
