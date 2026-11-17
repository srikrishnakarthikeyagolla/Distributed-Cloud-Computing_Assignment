import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { rateLimit } from "express-rate-limit";
import { createUser, DuplicateEmailError, findUserByEmail, findUserById } from "../models/User.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
const passwordPattern = /^[^\s]{8,72}$/;
const pincodePattern = /^[\p{L}\p{N}][\p{L}\p{N} -]{1,11}$/u;
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a little and try again." },
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
  };
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
    const user = await createUser({ name, email, passwordHash, pincode, address, job, workplace, interests });
    setSessionCookie(response, user.id);
    return response.status(201).json({ user: publicUser(user) });
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
    setSessionCookie(response, user.id);
    return response.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.post("/signout", (_request, response) => {
  response.clearCookie("session", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return response.json({ message: "Signed out." });
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
    return response.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

export default router;
