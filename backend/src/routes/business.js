import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import {
  createBusiness,
  findBusinessByEmail,
  findBusinessById,
  updateBusinessVisibility,
  updateBusinessPhotos,
} from "../models/Business.js";
import { findUserById } from "../models/User.js";
import {
  createBusinessMessage,
  listBusinessConversation,
  listBusinessMessagesForBusiness,
} from "../models/BusinessMessage.js";
import {
  addBusinessDealMessage,
  createBusinessDeal,
  findBusinessDealById,
  listBusinessDeals,
  listBusinessDealsForBusiness,
  updateBusinessDealStatus,
} from "../models/BusinessDeal.js";
import { requireBusinessAuth } from "../middleware/requireBusinessAuth.js";

const router = Router();
const passwordPattern = /^[^\s]{8,72}$/;
const pincodePattern = /^[\p{L}\p{N}][\p{L}\p{N} -]{1,11}$/u;
const photoDirectory = fileURLToPath(new URL("../../data/business-photos/", import.meta.url));
const photoTypes = new Map([
  ["image/jpeg", { extension: ".jpg", signature: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ["image/png", { extension: ".png", signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
  ["image/webp", { extension: ".webp", signature: (buffer) => buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" }],
]);
const signupLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
const signinLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please wait a little and try again." },
});
const businessPhotoLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
const businessMessageLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "You’re sending messages too quickly. Please wait a moment." },
});
const uploadPhotos = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 5 },
  fileFilter: (_request, file, callback) => {
    if (!photoTypes.has(file.mimetype)) {
      callback(new Error("Upload JPG, PNG, or WebP business photos."));
      return;
    }
    callback(null, true);
  },
});

function publicBusiness(business) {
  const { passwordHash, ...details } = business;
  return details;
}

function photoPath(fileName) {
  if (typeof fileName !== "string" || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(fileName)) {
    throw new Error("Invalid business photo filename.");
  }
  return join(photoDirectory, fileName);
}

function setBusinessSession(response, businessId) {
  const token = jwt.sign(
    { sub: businessId, accountType: "business" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );
  response.cookie("business_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function validateBusiness(input) {
  const businessName = typeof input.businessName === "string" ? input.businessName.trim() : "";
  const contactName = typeof input.contactName === "string" ? input.contactName.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const category = typeof input.category === "string" ? input.category.trim() : "";
  const pincode = typeof input.pincode === "string" ? input.pincode.trim().toUpperCase() : "";
  const address = typeof input.address === "string" ? input.address.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const services = Array.isArray(input.services)
    ? input.services.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    : [];
  const openingHours = typeof input.openingHours === "string" ? input.openingHours.trim() : "";
  const website = typeof input.website === "string" ? input.website.trim() : "";
  const latitude = input.locationConsent === true ? Number(input.latitude) : null;
  const longitude = input.locationConsent === true ? Number(input.longitude) : null;
  const locationConsent = input.locationConsent === true;

  if (!businessName || businessName.length > 100) return { error: "Enter a business name up to 100 characters." };
  if (!contactName || contactName.length > 80) return { error: "Enter the account contact name (up to 80 characters)." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: "Enter a valid business email address." };
  if (!passwordPattern.test(password)) return { error: "Password must be 8–72 characters with no spaces." };
  if (!/^\+?[\d\s().-]{7,20}$/.test(phone) || (phone.match(/\d/g) || []).length < 7) {
    return { error: "Enter a valid contact number with at least 7 digits." };
  }
  if (!category || category.length > 80) return { error: "Choose a business category (up to 80 characters)." };
  if (!pincodePattern.test(pincode)) return { error: "Enter a valid area pincode (2–12 letters or numbers)." };
  if (!address || address.length > 240) return { error: "Enter a business address up to 240 characters." };
  if (description.length > 2000) return { error: "The business description must be 2,000 characters or fewer." };
  if (services.length > 20 || services.some((service) => service.length > 80)) {
    return { error: "Add up to 20 products or services (80 characters each)." };
  }
  if (openingHours.length > 300) return { error: "Opening hours must be 300 characters or fewer." };
  if (website && website.length > 200) return { error: "The website address is too long." };
  if (website) {
    try {
      const url = new URL(website);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    } catch {
      return { error: "Enter a valid website URL beginning with http:// or https://." };
    }
  }
  if (
    locationConsent &&
    (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180)
  ) {
    return { error: "The shared location is invalid. Use the location button again or continue without it." };
  }

  return {
    value: {
      businessName,
      contactName,
      email,
      password,
      phone,
      category,
      pincode,
      address,
      description,
      services,
      openingHours,
      website,
      location: locationConsent ? { latitude, longitude } : null,
      photos: [],
    },
  };
}

function handlePhotoUpload(request, response, next) {
  uploadPhotos.array("photos", 5)(request, response, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return response.status(413).json({ error: "Each business photo must be 4 MB or smaller." });
    }
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_COUNT") {
      return response.status(400).json({ error: "Upload no more than 5 business photos." });
    }
    if (error instanceof multer.MulterError) {
      return response.status(400).json({ error: "Upload up to 5 business photos at a time." });
    }
    return response.status(400).json({ error: error.message });
  });
}

function validateDealProposal(input) {
  const proposal = typeof input === "string" ? input.trim() : "";
  if (!proposal || proposal.length > 2000) {
    return { error: "Describe the proposed deal in 1 to 2,000 characters." };
  }
  return { proposal };
}

function emitBusinessDealUpdate(request, deal) {
  request.app.get("io")
    ?.to(`business-conversation:${deal.userId}:${deal.businessId}`)
    .to(`user:${deal.userId}`)
    .to(`business:${deal.businessId}`)
    .emit("business-deal:update", deal);
}

async function findBusinessConversation(businessId, userId) {
  const [business, user] = await Promise.all([
    findBusinessById(businessId),
    findUserById(userId),
  ]);
  if (
    !business ||
    !user ||
    business.pincode.trim().toUpperCase() !== user.pincode.trim().toUpperCase()
  ) return null;
  return { business, user };
}

async function authorizeBusinessDeal(businessId, dealId) {
  const deal = await findBusinessDealById(dealId);
  if (!deal || deal.businessId !== businessId) return null;
  const pair = await findBusinessConversation(businessId, deal.userId);
  return pair ? { ...pair, deal } : null;
}

router.post("/signup", signupLimit, async (request, response, next) => {
  const result = validateBusiness(request.body ?? {});
  if (result.error) return response.status(400).json({ error: result.error });
  try {
    const { password, ...details } = result.value;
    const passwordHash = await bcrypt.hash(password, 12);
    const business = await createBusiness({ ...details, passwordHash });
    response.clearCookie("session", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    setBusinessSession(response, business.id);
    return response.status(201).json({ business: publicBusiness(business) });
  } catch (error) {
    if (error.name === "DuplicateBusinessEmailError") {
      return response.status(409).json({ error: "A business account with this email already exists." });
    }
    return next(error);
  }
});

router.post("/signin", signinLimit, async (request, response, next) => {
  const { email, password } = request.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || password.length > 72) {
    return response.status(400).json({ error: "Enter your business email and password." });
  }
  try {
    const business = await findBusinessByEmail(email.trim().toLowerCase());
    if (!business || !(await bcrypt.compare(password, business.passwordHash))) {
      return response.status(401).json({ error: "Business email or password is incorrect." });
    }
    response.clearCookie("session", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    setBusinessSession(response, business.id);
    return response.json({ business: publicBusiness(business) });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", requireBusinessAuth, async (request, response, next) => {
  try {
    const business = await findBusinessById(request.businessId);
    if (!business) return response.status(401).json({ error: "Your business account could not be found." });
    return response.json({ business: publicBusiness(business) });
  } catch (error) {
    return next(error);
  }
});

router.put("/visibility", requireBusinessAuth, async (request, response, next) => {
  if (typeof request.body?.isVisible !== "boolean") {
    return response.status(400).json({ error: "Choose whether your business profile is visible." });
  }
  try {
    const business = await updateBusinessVisibility(request.businessId, request.body.isVisible);
    if (!business) return response.status(404).json({ error: "Your business account could not be found." });
    return response.json({ business: publicBusiness(business) });
  } catch (error) {
    return next(error);
  }
});

router.get("/conversations", requireBusinessAuth, async (request, response, next) => {
  try {
    const messages = await listBusinessMessagesForBusiness(request.businessId);
    const deals = await listBusinessDealsForBusiness(request.businessId);
    const conversations = new Map();
    for (const message of messages) {
      const current = conversations.get(message.userId);
      if (!current || current.lastMessage.createdAt < message.createdAt) {
        conversations.set(message.userId, { lastMessage: message });
      }
    }
    for (const deal of deals) {
      const current = conversations.get(deal.userId);
      if (!current || current.lastMessage.createdAt < deal.updatedAt) {
        conversations.set(deal.userId, {
          lastMessage: {
            content: deal.messages.at(-1)?.content || deal.proposal,
            createdAt: deal.updatedAt,
            type: "deal",
          },
        });
      }
    }
    const results = await Promise.all(
      [...conversations].map(async ([userId, conversation]) => {
        const user = await findUserById(userId);
        if (!user) return null;
        return {
          user: { id: user.id, name: user.name },
          lastMessage: conversation.lastMessage,
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

router.get("/conversations/:userId/deals", requireBusinessAuth, async (request, response, next) => {
  try {
    const pair = await findBusinessConversation(request.businessId, request.params.userId);
    if (!pair) return response.status(404).json({ error: "That customer is not available in your area." });
    const deals = await listBusinessDeals(pair.user.id, pair.business.id);
    if (
      pair.business.isVisible === false &&
      deals.length === 0 &&
      (await listBusinessConversation(pair.user.id, pair.business.id)).length === 0
    ) return response.status(404).json({ error: "That conversation is not available." });
    return response.json({ deals });
  } catch (error) {
    return next(error);
  }
});

router.get("/deals/active", requireBusinessAuth, async (request, response, next) => {
  try {
    const deals = (await listBusinessDealsForBusiness(request.businessId))
      .filter((deal) => deal.status === "pending" || deal.status === "accepted")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const activeDeals = await Promise.all(deals.map(async (deal) => {
      const user = await findUserById(deal.userId);
      return user ? { ...deal, customer: { id: user.id, name: user.name } } : null;
    }));
    return response.json({ deals: activeDeals.filter(Boolean) });
  } catch (error) {
    return next(error);
  }
});

router.post("/conversations/:userId/deals", requireBusinessAuth, businessMessageLimit, async (request, response, next) => {
  const result = validateDealProposal(request.body?.proposal);
  if (result.error) return response.status(400).json({ error: result.error });
  try {
    const pair = await findBusinessConversation(request.businessId, request.params.userId);
    if (!pair) return response.status(404).json({ error: "That customer is not available in your area." });
    const [existingDeals, existingMessages] = await Promise.all([
      listBusinessDeals(pair.user.id, pair.business.id),
      listBusinessConversation(pair.user.id, pair.business.id),
    ]);
    if (existingMessages.length === 0 && existingDeals.length === 0) {
      return response.status(404).json({ error: "The customer must start the conversation before you can propose a deal." });
    }
    const deal = await createBusinessDeal({
      userId: pair.user.id,
      businessId: pair.business.id,
      creatorType: "business",
      proposal: result.proposal,
    });
    emitBusinessDealUpdate(request, deal);
    return response.status(201).json({ deal });
  } catch (error) {
    return next(error);
  }
});

router.post("/deals/:dealId/status", requireBusinessAuth, async (request, response, next) => {
  const action = request.body?.action;
  if (!["accept", "pass", "fulfill"].includes(action)) {
    return response.status(400).json({ error: "Choose an available deal action." });
  }
  try {
    const authorized = await authorizeBusinessDeal(request.businessId, request.params.dealId);
    if (!authorized) return response.status(404).json({ error: "That deal could not be found." });
    const { deal } = authorized;
    if (action === "accept" || action === "pass") {
      if (deal.status !== "pending" || deal.creatorType === "business") {
        return response.status(409).json({ error: "This proposal is no longer awaiting your response." });
      }
    } else if (deal.status !== "accepted") {
      return response.status(409).json({ error: "Only an accepted deal can be marked fulfilled." });
    }
    const updatedDeal = await updateBusinessDealStatus(deal.id, action, "business");
    if (!updatedDeal) return response.status(409).json({ error: "This deal has already changed and can no longer be updated." });
    emitBusinessDealUpdate(request, updatedDeal);
    return response.json({ deal: updatedDeal });
  } catch (error) {
    return next(error);
  }
});

router.post("/deals/:dealId/messages", requireBusinessAuth, businessMessageLimit, async (request, response, next) => {
  const content = typeof request.body?.content === "string" ? request.body.content.trim() : "";
  if (!content || content.length > 2000) {
    return response.status(400).json({ error: "Messages must be between 1 and 2,000 characters." });
  }
  try {
    const authorized = await authorizeBusinessDeal(request.businessId, request.params.dealId);
    if (!authorized) return response.status(404).json({ error: "That deal could not be found." });
    const result = await addBusinessDealMessage(authorized.deal.id, "business", content);
    if (!result) return response.status(409).json({ error: "Deal chat is available while an accepted deal is active." });
    emitBusinessDealUpdate(request, result.deal);
    return response.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

router.get("/conversations/:userId", requireBusinessAuth, async (request, response, next) => {
  try {
    const [business, user] = await Promise.all([
      findBusinessById(request.businessId),
      findUserById(request.params.userId),
    ]);
    if (!business || !user || business.pincode.trim().toUpperCase() !== user.pincode.trim().toUpperCase()) {
      return response.status(404).json({ error: "That customer is not available in your area." });
    }
    const messages = await listBusinessConversation(user.id, business.id);
    const deals = await listBusinessDeals(user.id, business.id);
    if (messages.length === 0 && deals.length === 0) {
      return response.status(404).json({ error: "A customer must start the conversation before you can reply." });
    }
    return response.json({ messages });
  } catch (error) {
    return next(error);
  }
});

router.post("/conversations/:userId", requireBusinessAuth, businessMessageLimit, async (request, response, next) => {
  const content = typeof request.body?.content === "string" ? request.body.content.trim() : "";
  if (!content || content.length > 2000) {
    return response.status(400).json({ error: "Messages must be between 1 and 2,000 characters." });
  }
  try {
    const [business, user] = await Promise.all([
      findBusinessById(request.businessId),
      findUserById(request.params.userId),
    ]);
    if (!business || !user || business.pincode.trim().toUpperCase() !== user.pincode.trim().toUpperCase()) {
      return response.status(404).json({ error: "That customer is not available in your area." });
    }
    const [existingMessages, existingDeals] = await Promise.all([
      listBusinessConversation(user.id, business.id),
      listBusinessDeals(user.id, business.id),
    ]);
    if (existingMessages.length === 0 && existingDeals.length === 0) {
      return response.status(404).json({ error: "A customer must start the conversation before you can reply." });
    }
    const message = await createBusinessMessage({
      userId: user.id,
      businessId: business.id,
      senderType: "business",
      content,
    });
    request.app.get("io")
      ?.to(`business-conversation:${user.id}:${business.id}`)
      .to(`user:${user.id}`)
      .to(`business:${business.id}`)
      .emit("business-chat:message", message);
    return response.status(201).json({ message });
  } catch (error) {
    return next(error);
  }
});

router.post("/signout", (_request, response) => {
  response.clearCookie("business_session", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return response.json({ message: "Signed out." });
});

router.post("/photos", requireBusinessAuth, businessPhotoLimit, handlePhotoUpload, async (request, response, next) => {
  const files = request.files || [];
  if (files.length === 0) return response.status(400).json({ error: "Choose at least one business photo." });
  if (files.some((file) => !photoTypes.get(file.mimetype).signature(file.buffer))) {
    return response.status(400).json({ error: "A selected file is not a valid JPG, PNG, or WebP image." });
  }

  const savedPaths = [];
  try {
    const business = await findBusinessById(request.businessId);
    if (!business) return response.status(404).json({ error: "Your business account could not be found." });
    const currentPhotos = business.photos || [];
    if (currentPhotos.length + files.length > 5) {
      return response.status(400).json({ error: "A business profile can have up to 5 photos." });
    }
    await mkdir(photoDirectory, { recursive: true });
    const newPhotos = [];
    for (const file of files) {
      const extension = photoTypes.get(file.mimetype).extension;
      const fileName = `${randomUUID()}${extension}`;
      const destination = photoPath(fileName);
      await writeFile(destination, file.buffer, { flag: "wx", mode: 0o600 });
      savedPaths.push(destination);
      newPhotos.push(fileName);
    }
    const updated = await updateBusinessPhotos(business.id, [...currentPhotos, ...newPhotos]);
    if (!updated) return response.status(404).json({ error: "Your business account could not be found." });
    return response.status(201).json({ business: publicBusiness(updated.business) });
  } catch (error) {
    const cleanupResults = await Promise.allSettled(savedPaths.map((filePath) => rm(filePath, { force: true })));
    const cleanupErrors = cleanupResults.filter((result) => result.status === "rejected").map((result) => result.reason);
    return next(cleanupErrors.length
      ? new AggregateError([error, ...cleanupErrors], "Failed to save business photos and clean up.")
      : error);
  }
});

router.delete("/photos/:fileName", requireBusinessAuth, async (request, response, next) => {
  try {
    const business = await findBusinessById(request.businessId);
    if (!business || !(business.photos || []).includes(request.params.fileName)) {
      return response.status(404).json({ error: "Business photo not found." });
    }
    const photos = business.photos.filter((fileName) => fileName !== request.params.fileName);
    const updated = await updateBusinessPhotos(business.id, photos);
    await rm(photoPath(request.params.fileName), { force: true });
    return response.json({ business: publicBusiness(updated.business) });
  } catch (error) {
    return next(error);
  }
});

router.get("/photos/:fileName", requireBusinessAuth, async (request, response, next) => {
  try {
    const business = await findBusinessById(request.businessId);
    if (!business || !(business.photos || []).includes(request.params.fileName)) {
      return response.status(404).json({ error: "Business photo not found." });
    }
    const photoType = [...photoTypes.entries()].find(([, value]) => request.params.fileName.endsWith(value.extension));
    if (!photoType) return response.status(404).json({ error: "Business photo not found." });
    const contents = await readFile(photoPath(request.params.fileName));
    return response
      .type(photoType[0])
      .set("X-Content-Type-Options", "nosniff")
      .set("Cache-Control", "private, no-store")
      .send(contents);
  } catch (error) {
    if (error.code === "ENOENT") return response.status(404).json({ error: "Business photo not found." });
    return next(error);
  }
});

export default router;
