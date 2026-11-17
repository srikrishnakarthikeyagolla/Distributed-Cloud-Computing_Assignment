import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { findUserById, findUsersByPincode } from "../models/User.js";
import { createMessage, listConversation } from "../models/ChatMessage.js";
import { rateLimit } from "express-rate-limit";

const router = Router();
const messageRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "You’re sending messages too quickly. Please wait a moment." },
});

function publicNeighbor(user) {
  return {
    id: user.id,
    name: user.name,
    job: user.job,
    workplace: user.workplace,
    interests: user.interests,
  };
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
    const people = await findUsersByPincode(user.pincode, user.id);
    return response.json({ people: people.map(publicNeighbor), pincode: user.pincode });
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
    return response.status(201).json({ message: publicMessage(message) });
  } catch (error) {
    return next(error);
  }
});

export default router;
