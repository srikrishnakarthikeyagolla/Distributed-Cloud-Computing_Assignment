import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import jwt from "jsonwebtoken";
import { Server as SocketServer } from "socket.io";
import { initializeUserStore } from "./models/User.js";
import { initializeMessageStore } from "./models/ChatMessage.js";
import { findUserById } from "./models/User.js";
import { createMessage } from "./models/ChatMessage.js";
import { initializeConnectionStore } from "./models/Connection.js";
import { findBusinessById, initializeBusinessStore } from "./models/Business.js";
import {
  createBusinessMessage,
  initializeBusinessMessageStore,
  listBusinessConversation,
} from "./models/BusinessMessage.js";
import {
  initializeBusinessDealStore,
  listBusinessDeals,
} from "./models/BusinessDeal.js";
import { initializeBusinessReviewStore } from "./models/BusinessReview.js";
import { initializeBusinessProductStore } from "./models/BusinessProduct.js";
import { initializeServiceProviderStore } from "./models/ServiceProvider.js";
import { initializeServiceMessageStore } from "./models/ServiceMessage.js";
import { initializeServiceReviewStore } from "./models/ServiceReview.js";
import authRouter from "./routes/auth.js";
import locationRouter from "./routes/location.js";
import neighborhoodRouter from "./routes/neighborhood.js";
import businessRouter from "./routes/business.js";
import serviceProviderRouter from "./routes/serviceProviders.js";

const app = express();
const httpServer = createServer(app);
const port = Number(process.env.PORT) || 5000;
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const io = new SocketServer(httpServer, {
  cors: {
    origin: frontendOrigin,
    credentials: true,
  },
});

app.set("io", io);

app.use(cors({ origin: frontendOrigin, credentials: true }));
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", message: "Backend is connected." });
});

app.use("/api/auth", authRouter);
app.use("/api/location", locationRouter);
app.use("/api/neighborhood", neighborhoodRouter);
app.use("/api/business", businessRouter);
app.use("/api/service-providers", serviceProviderRouter);

function conversationRoom(firstUserId, secondUserId) {
  return `conversation:${[firstUserId, secondUserId].sort().join(":")}`;
}

function parseCookies(cookieHeader) {
  const cookies = Object.fromEntries(
    (cookieHeader || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name, value]) => name && value),
  );
  return Object.fromEntries(
    Object.entries(cookies).map(([name, value]) => [name, decodeURIComponent(value)]),
  );
}

async function getBusinessChatPair(userId, businessId) {
  if (!userId || !businessId) return null;
  const [currentUser, business] = await Promise.all([
    findUserById(userId),
    findBusinessById(businessId),
  ]);
  if (
    !currentUser ||
    !business ||
    (currentUser.pincode || "").trim().toUpperCase() !== (business.pincode || "").trim().toUpperCase()
  ) {
    return null;
  }
  return { currentUser, business };
}

async function getSameAreaPair(currentUserId, recipientId) {
  if (!recipientId || currentUserId === recipientId) return null;
  const [currentUser, recipient] = await Promise.all([
    findUserById(currentUserId),
    findUserById(recipientId),
  ]);
  if (
    !currentUser ||
    !recipient ||
    currentUser.pincode.trim().toUpperCase() !== recipient.pincode.trim().toUpperCase()
  ) {
    return null;
  }
  return { currentUser, recipient };
}

io.use((socket, next) => {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  const token = cookies.service_provider_session || cookies.business_session || cookies.session;
  if (!token) return next(new Error("Authentication required"));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (typeof payload === "string" || typeof payload.sub !== "string") {
      return next(new Error("Invalid session"));
    }
    socket.accountType = payload.accountType === "serviceProvider"
      ? "serviceProvider"
      : payload.accountType === "business" ? "business" : "user";
    socket.accountId = payload.sub;
    return next();
  } catch {
    return next(new Error("Invalid or expired session"));
  }
});

io.on("connection", (socket) => {
  socket.join(`${socket.accountType}:${socket.accountId}`);
  if (socket.accountType === "serviceProvider") socket.join(`service-provider:${socket.accountId}`);

  socket.on("chat:join", async (recipientId, acknowledge = () => {}) => {
    try {
      if (socket.accountType !== "user") {
        acknowledge({ ok: false, error: "Personal chat requires a neighborhood account." });
        return;
      }
      const pair = await getSameAreaPair(socket.accountId, recipientId);
      if (!pair) {
        acknowledge({ ok: false, error: "That neighbor isn’t available in your area." });
        return;
      }

      for (const room of [...socket.rooms].filter((room) => room.startsWith("conversation:"))) {
        socket.leave(room);
      }
      const room = conversationRoom(pair.currentUser.id, pair.recipient.id);
      await socket.join(room);
      acknowledge({ ok: true, room });
    } catch (error) {
      acknowledge({ ok: false, error: "Could not join the conversation." });
    }
  });

  socket.on("chat:send", async ({ recipientId, content }, acknowledge = () => {}) => {
    if (socket.accountType !== "user") {
      acknowledge({ ok: false, error: "Personal chat requires a neighborhood account." });
      return;
    }
    const trimmedContent = typeof content === "string" ? content.trim() : "";
    if (!trimmedContent || trimmedContent.length > 2000) {
      acknowledge({ ok: false, error: "Messages must be between 1 and 2,000 characters." });
      return;
    }

    try {
      const pair = await getSameAreaPair(socket.accountId, recipientId);
      if (!pair) {
        acknowledge({ ok: false, error: "That neighbor isn’t available in your area." });
        return;
      }

      const message = await createMessage({
        senderId: pair.currentUser.id,
        recipientId: pair.recipient.id,
        content: trimmedContent,
      });
      const publicMessage = {
        id: message.id,
        senderId: message.senderId,
        recipientId: message.recipientId,
        content: message.content,
        createdAt: message.createdAt,
      };
      io.to(conversationRoom(pair.currentUser.id, pair.recipient.id)).emit("chat:message", publicMessage);
      acknowledge({ ok: true, message: publicMessage });
    } catch (error) {
      acknowledge({ ok: false, error: "Could not send the message." });
    }
  });

  socket.on("business-chat:join", async (otherAccountId, acknowledge = () => {}) => {
    try {
      const pair =
        socket.accountType === "user"
          ? await getBusinessChatPair(socket.accountId, otherAccountId)
          : await getBusinessChatPair(otherAccountId, socket.accountId);
      if (!pair) {
        acknowledge({ ok: false, error: "That business isn’t available for chat." });
        return;
      }
      if (socket.accountType === "user" && pair.business.isVisible === false) {
        const [existingMessages, existingDeals] = await Promise.all([
          listBusinessConversation(pair.currentUser.id, pair.business.id),
          listBusinessDeals(pair.currentUser.id, pair.business.id),
        ]);
        if (existingMessages.length === 0 && existingDeals.length === 0) {
          acknowledge({ ok: false, error: "That business isn’t available for chat." });
          return;
        }
      }
      if (socket.accountType === "business") {
        const [existingMessages, existingDeals] = await Promise.all([
          listBusinessConversation(pair.currentUser.id, pair.business.id),
          listBusinessDeals(pair.currentUser.id, pair.business.id),
        ]);
        if (existingMessages.length === 0 && existingDeals.length === 0) {
          acknowledge({ ok: false, error: "The customer must start the conversation before you can reply." });
          return;
        }
      }
      const room = `business-conversation:${pair.currentUser.id}:${pair.business.id}`;
      await socket.join(room);
      acknowledge({ ok: true, room });
    } catch {
      acknowledge({ ok: false, error: "Could not join the business conversation." });
    }
  });

  socket.on("business-chat:send", async ({ otherAccountId, content }, acknowledge = () => {}) => {
    const trimmedContent = typeof content === "string" ? content.trim() : "";
    if (!trimmedContent || trimmedContent.length > 2000) {
      acknowledge({ ok: false, error: "Messages must be between 1 and 2,000 characters." });
      return;
    }
    try {
      const pair =
        socket.accountType === "user"
          ? await getBusinessChatPair(socket.accountId, otherAccountId)
          : await getBusinessChatPair(otherAccountId, socket.accountId);
      if (!pair) {
        acknowledge({ ok: false, error: "That business conversation isn’t available." });
        return;
      }
      if (socket.accountType === "user" && pair.business.isVisible === false) {
        const [existingMessages, existingDeals] = await Promise.all([
          listBusinessConversation(pair.currentUser.id, pair.business.id),
          listBusinessDeals(pair.currentUser.id, pair.business.id),
        ]);
        if (existingMessages.length === 0 && existingDeals.length === 0) {
          acknowledge({ ok: false, error: "This business is not currently accepting new chats." });
          return;
        }
      }
      if (socket.accountType === "business") {
        const [existingMessages, existingDeals] = await Promise.all([
          listBusinessConversation(pair.currentUser.id, pair.business.id),
          listBusinessDeals(pair.currentUser.id, pair.business.id),
        ]);
        if (existingMessages.length === 0 && existingDeals.length === 0) {
          acknowledge({ ok: false, error: "The customer must start the conversation before you can reply." });
          return;
        }
      }
      const message = await createBusinessMessage({
        userId: pair.currentUser.id,
        businessId: pair.business.id,
        senderType: socket.accountType,
        content: trimmedContent,
      });
      const publicMessage = {
        id: message.id,
        userId: message.userId,
        businessId: message.businessId,
        senderType: message.senderType,
        content: message.content,
        createdAt: message.createdAt,
      };
      io
        .to(`business-conversation:${pair.currentUser.id}:${pair.business.id}`)
        .to(`user:${pair.currentUser.id}`)
        .to(`business:${pair.business.id}`)
        .emit("business-chat:message", publicMessage);
      acknowledge({ ok: true, message: publicMessage });
    } catch {
      acknowledge({ ok: false, error: "Could not send the business message." });
    }
  });
});

app.use((error, _request, response, _next) => {
  console.error("API error:", error);
  if (response.headersSent) return;
  response.status(error.status || 500).json({
    error: error.status ? error.message : "Something went wrong. Please try again.",
  });
});

async function startServer() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be set to a random value of at least 32 characters.");
  }

  await initializeUserStore();
  await initializeMessageStore();
  await initializeConnectionStore();
  await initializeBusinessStore();
  await initializeBusinessMessageStore();
  await initializeBusinessDealStore();
  await initializeBusinessReviewStore();
  await initializeBusinessProductStore();
  await initializeServiceProviderStore();
  await initializeServiceMessageStore();
  await initializeServiceReviewStore();
  console.log("Using local JSON stores at backend/data/.");

  httpServer.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start backend:", error.message);
  process.exitCode = 1;
});
