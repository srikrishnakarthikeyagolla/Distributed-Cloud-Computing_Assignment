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
import authRouter from "./routes/auth.js";
import locationRouter from "./routes/location.js";
import neighborhoodRouter from "./routes/neighborhood.js";

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

function conversationRoom(firstUserId, secondUserId) {
  return `conversation:${[firstUserId, secondUserId].sort().join(":")}`;
}

function parseSessionCookie(cookieHeader) {
  const cookies = Object.fromEntries(
    (cookieHeader || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name, value]) => name && value),
  );
  return cookies.session ? decodeURIComponent(cookies.session) : null;
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
  const token = parseSessionCookie(socket.handshake.headers.cookie);
  if (!token) return next(new Error("Authentication required"));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (typeof payload === "string" || typeof payload.sub !== "string") {
      return next(new Error("Invalid session"));
    }
    socket.userId = payload.sub;
    return next();
  } catch {
    return next(new Error("Invalid or expired session"));
  }
});

io.on("connection", (socket) => {
  socket.join(`user:${socket.userId}`);

  socket.on("chat:join", async (recipientId, acknowledge = () => {}) => {
    try {
      const pair = await getSameAreaPair(socket.userId, recipientId);
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
    const trimmedContent = typeof content === "string" ? content.trim() : "";
    if (!trimmedContent || trimmedContent.length > 2000) {
      acknowledge({ ok: false, error: "Messages must be between 1 and 2,000 characters." });
      return;
    }

    try {
      const pair = await getSameAreaPair(socket.userId, recipientId);
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
  console.log("Using local JSON stores at backend/data/.");

  httpServer.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start backend:", error.message);
  process.exitCode = 1;
});
