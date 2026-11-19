import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createUser,
  DuplicateEmailError,
  findUserByEmail,
  findUserById,
  findUsersByPincode,
  updateUserPasswordHash,
  updateUserProfilePhoto,
  updateUserVisibility,
} from "../models/User.js";
import { findConnection } from "../models/Connection.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
const passwordPattern = /^[^\s]{8,72}$/;
const pincodePattern = /^[\p{L}\p{N}][\p{L}\p{N} -]{1,11}$/u;
const profilePhotoDirectory = fileURLToPath(new URL("../../data/profile-photos/", import.meta.url));
const photoTypes = new Map([
  ["image/jpeg", { extension: ".jpg", signature: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ["image/png", { extension: ".png", signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
  ["image/webp", { extension: ".webp", signature: (buffer) => buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" }],
]);
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!photoTypes.has(file.mimetype)) {
      callback(new Error("Upload a JPG, PNG, or WebP profile photo."));
      return;
    }
    callback(null, true);
  },
});
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a little and try again." },
});
const passwordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many password changes. Please wait before trying again." },
});
const photoRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many profile photo uploads. Please wait before trying again." },
});

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    pincode: user.pincode,
    address: user.address,
    job: user.job,
    workplace: user.workplace,
    interests: user.interests,
    visibility: user.visibility || "connections",
    profilePhotoUrl: user.profilePhoto
      ? `/api/auth/profile-photo/${user.id}?v=${encodeURIComponent(user.profilePhoto)}`
      : null,
  };
}

function photoPath(fileName) {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(fileName)) {
    throw new Error("Invalid profile photo filename.");
  }
  return join(profilePhotoDirectory, fileName);
}

function profilePhotoUpload(request, response, next) {
  photoUpload.single("photo")(request, response, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return response.status(413).json({ error: "Profile photos must be 2 MB or smaller." });
    }
    if (error instanceof multer.MulterError) {
      return response.status(400).json({ error: "Upload one profile photo at a time." });
    }
    return response.status(400).json({ error: error.message });
  });
}

function setSessionCookie(response, userId) {
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
  response.cookie("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function getLastSection(request) {
  return request.cookies.last_section === "business" ? "business" : "community";
}

function setLastSectionCookie(response, section) {
  response.cookie("last_section", section, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
}

function validateProfile(body, { includeCredentials }) {
  const input = body && typeof body === "object" ? body : {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const pincode = typeof input.pincode === "string" ? input.pincode.trim().toUpperCase() : "";
  const address = typeof input.address === "string" ? input.address.trim() : "";
  const job = typeof input.job === "string" ? input.job.trim() : "";
  const workplace = typeof input.workplace === "string" ? input.workplace.trim() : "";
  const interests = Array.isArray(input.interests)
    ? input.interests.filter((interest) => typeof interest === "string").map((interest) => interest.trim()).filter(Boolean)
    : [];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { error: "Enter a valid email address." };
  }
  if (includeCredentials && (!passwordPattern.test(password))) {
    return { error: "Password must be 8–72 characters with no spaces." };
  }
  if (includeCredentials && (!name || name.length > 80)) {
    return { error: "Please enter your name (up to 80 characters)." };
  }
  if (includeCredentials && (!pincodePattern.test(pincode))) {
    return { error: "Enter a valid pincode (2–12 letters or numbers)." };
  }
  if (address.length > 200 || job.length > 100 || workplace.length > 120) {
    return { error: "One of your profile fields is too long." };
  }
  if (interests.length > 15 || interests.some((interest) => interest.length > 40)) {
    return { error: "Add up to 15 interests, with no more than 40 characters each." };
  }

  return {
    value: { name, email, password, pincode, address, job, workplace, interests },
  };
}

router.post("/signup", authRateLimit, async (request, response, next) => {
  const result = validateProfile(request.body, { includeCredentials: true });
  if (result.error) return response.status(400).json({ error: result.error });

  try {
    const { name, email, password, pincode, address, job, workplace, interests } = result.value;
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await createUser({
      name,
      email,
      passwordHash,
      pincode,
      address,
      job,
      workplace,
      interests,
      visibility: "connections",
    });
    response.clearCookie("business_session", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    response.clearCookie("service_provider_session", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    setSessionCookie(response, user.id);
    setLastSectionCookie(response, "community");
    return response.status(201).json({ user: publicUser(user), lastSection: "community" });
  } catch (error) {
    if (error instanceof DuplicateEmailError) {
      return response.status(409).json({ error: "An account with this email already exists." });
    }
    return next(error);
  }
});

router.post("/signin", authRateLimit, async (request, response, next) => {
  const { email, password } = request.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || password.length > 72) {
    return response.status(400).json({ error: "Enter your email and password." });
  }

  try {
    const user = await findUserByEmail(email.trim().toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return response.status(401).json({ error: "Email or password is incorrect." });
    }
    response.clearCookie("business_session", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    response.clearCookie("service_provider_session", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    setSessionCookie(response, user.id);
    return response.json({ user: publicUser(user), lastSection: getLastSection(request) });
  } catch (error) {
    return next(error);
  }
});

router.post("/signout", (_request, response) => {
  for (const cookieName of ["session", "business_session", "service_provider_session"]) {
    response.clearCookie(cookieName, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
  }
  return response.json({ message: "Signed out." });
});

router.post("/last-section", requireAuth, (request, response) => {
  const { section } = request.body ?? {};
  if (section !== "business" && section !== "community") {
    return response.status(400).json({ error: "Choose the business or community section." });
  }
  setLastSectionCookie(response, section);
  return response.json({ lastSection: section });
});

router.get("/me", requireAuth, async (request, response, next) => {
  try {
    const user = await findUserById(request.userId);
    if (!user) {
      response.clearCookie("session", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
      return response.status(401).json({ error: "Your account could not be found. Please sign in again." });
    }
    return response.json({ user: publicUser(user), lastSection: getLastSection(request) });
  } catch (error) {
    return next(error);
  }
});

router.put("/visibility", requireAuth, async (request, response, next) => {
  const { visibility } = request.body ?? {};
  if (!["public", "private", "connections"].includes(visibility)) {
    return response.status(400).json({ error: "Choose public, private, or connections visibility." });
  }
  try {
    const user = await updateUserVisibility(request.userId, visibility);
    if (!user) return response.status(404).json({ error: "Your account could not be found." });
    const neighbors = await findUsersByPincode(user.pincode, user.id);
    for (const neighbor of neighbors) {
      request.app.get("io")?.to(`user:${neighbor.id}`).emit("profile:update");
    }
    return response.json({ visibility: user.visibility });
  } catch (error) {
    return next(error);
  }
});

router.put("/password", requireAuth, passwordRateLimit, async (request, response, next) => {
  const { currentPassword, newPassword } = request.body ?? {};
  if (
    typeof currentPassword !== "string" ||
    currentPassword.length === 0 ||
    currentPassword.length > 72 ||
    typeof newPassword !== "string" ||
    !passwordPattern.test(newPassword)
  ) {
    return response.status(400).json({
      error: "Enter your current password and a new password of 8–72 characters with no spaces.",
    });
  }

  try {
    const user = await findUserById(request.userId);
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return response.status(400).json({ error: "Your current password is incorrect." });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updatedUser = await updateUserPasswordHash(user.id, passwordHash);
    if (!updatedUser) return response.status(404).json({ error: "Your account could not be found." });
    return response.json({ message: "Password updated." });
  } catch (error) {
    return next(error);
  }
});

router.post("/profile-photo", requireAuth, photoRateLimit, profilePhotoUpload, async (request, response, next) => {
  if (!request.file) return response.status(400).json({ error: "Choose a profile photo to upload." });
  const photoType = photoTypes.get(request.file.mimetype);
  if (!photoType.signature(request.file.buffer)) {
    return response.status(400).json({ error: "The selected file is not a valid JPG, PNG, or WebP image." });
  }

  let destination;
  let saved = false;
  try {
    const existingUser = await findUserById(request.userId);
    if (!existingUser) return response.status(404).json({ error: "Your account could not be found." });
    const fileName = `${randomUUID()}${photoType.extension}`;
    destination = photoPath(fileName);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, request.file.buffer, { flag: "wx", mode: 0o600 });
    const result = await updateUserProfilePhoto(existingUser.id, fileName);
    if (!result) {
      await rm(destination, { force: true });
      return response.status(404).json({ error: "Your account could not be found." });
    }
    saved = true;
    if (result.previousPhoto) {
      await rm(photoPath(result.previousPhoto), { force: true });
    }
    const neighbors = await findUsersByPincode(existingUser.pincode, existingUser.id);
    for (const neighbor of neighbors) {
      request.app.get("io")?.to(`user:${neighbor.id}`).emit("profile:update");
    }
    return response.json({ user: publicUser(result.user) });
  } catch (error) {
    if (destination && !saved) {
      try {
        await rm(destination, { force: true });
      } catch (cleanupError) {
        return next(new AggregateError([error, cleanupError], "Failed to save profile photo and clean up its file."));
      }
    }
    return next(error);
  }
});

router.delete("/profile-photo", requireAuth, async (request, response, next) => {
  try {
    const user = await findUserById(request.userId);
    if (!user) return response.status(404).json({ error: "Your account could not be found." });
    if (user.profilePhoto) {
      const result = await updateUserProfilePhoto(user.id, null);
      if (!result) return response.status(404).json({ error: "Your account could not be found." });
      await rm(photoPath(user.profilePhoto), { force: true });
    }
    const neighbors = await findUsersByPincode(user.pincode, user.id);
    for (const neighbor of neighbors) {
      request.app.get("io")?.to(`user:${neighbor.id}`).emit("profile:update");
    }
    return response.json({ user: publicUser({ ...user, profilePhoto: null }) });
  } catch (error) {
    return next(error);
  }
});

router.get("/profile-photo/:userId", requireAuth, async (request, response, next) => {
  try {
    const [viewer, target] = await Promise.all([
      findUserById(request.userId),
      findUserById(request.params.userId),
    ]);
    if (!viewer || !target || !target.profilePhoto) {
      return response.status(404).json({ error: "Profile photo not found." });
    }
    if (viewer.id !== target.id) {
      const sameArea = viewer.pincode.trim().toUpperCase() === target.pincode.trim().toUpperCase();
      const connection = await findConnection(viewer.id, target.id);
      const allowed =
        sameArea &&
        (target.visibility === "public" ||
          ((target.visibility || "connections") === "connections" && connection?.status === "accepted"));
      if (!allowed) return response.status(404).json({ error: "Profile photo not found." });
    }
    if (typeof target.profilePhoto !== "string") {
      return response.status(404).json({ error: "Profile photo not found." });
    }
    const photoType = [...photoTypes.entries()].find(([, value]) => target.profilePhoto.endsWith(value.extension));
    if (!photoType) return response.status(404).json({ error: "Profile photo not found." });
    const contents = await readFile(photoPath(target.profilePhoto));
    return response
      .type(photoType[0])
      .set("X-Content-Type-Options", "nosniff")
      .set("Cache-Control", "private, no-store")
      .send(contents);
  } catch (error) {
    if (error.code === "ENOENT") return response.status(404).json({ error: "Profile photo not found." });
    return next(error);
  }
});

export default router;
