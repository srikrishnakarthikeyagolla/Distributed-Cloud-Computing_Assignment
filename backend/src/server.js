import "dotenv/config";
import cors from "cors";
import express from "express";
import mongoose from "mongoose";

const app = express();
const port = Number(process.env.PORT) || 5000;
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

app.use(cors({ origin: frontendOrigin }));
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", message: "Backend is connected." });
});

async function startServer() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is missing. Set it in backend/.env.");
  }

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB.");

  app.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start backend:", error.message);
  process.exitCode = 1;
});

