import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { rateLimit } from "express-rate-limit";
import { indiaServices } from "../data/indiaServices.js";
import {
  createServiceProvider,
  findServiceProviderByEmail,
  findServiceProviderById,
  findServiceProvidersByPincode,
  updateServiceProvider,
} from "../models/ServiceProvider.js";
import { findUserById } from "../models/User.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireServiceProviderAuth } from "../middleware/requireServiceProviderAuth.js";
import {
  addBusinessDealMessage,
  createBusinessDeal,
  findBusinessDealById,
  listServiceDeals,
  listServiceDealsForProvider,
  listServiceDealsForUser,
  updateBusinessDealStatus,
} from "../models/BusinessDeal.js";
import {
  createServiceMessage,
  listServiceConversation,
  listServiceMessagesForProvider,
  listServiceMessagesForUser,
} from "../models/ServiceMessage.js";
import { listServiceReviews, saveServiceReview } from "../models/ServiceReview.js";

const router = Router();
const passwordPattern = /^[^\s]{8,72}$/;
const pincodePattern = /^\d{6}$/;
const phonePattern = /^(?:(?:\+91|91)[ -]?)?[6-9]\d{9}$/;
const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a little and try again." },
});
const messageLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "You’re sending messages too quickly. Please wait a moment." },
});

function publicProvider(provider, includeContact = false) {
  const { passwordHash, location, email, phone, ...details } = provider;
  const safeDetails = {
    ...details,
    services: Array.isArray(details.services) ? details.services : [],
    serviceDetails: details.serviceDetails && typeof details.serviceDetails === "object" && !Array.isArray(details.serviceDetails)
      ? details.serviceDetails
      : {},
  };
  return includeContact ? { ...safeDetails, email, phone } : safeDetails;
}

function publicDeal(deal) {
  return {
    ...deal,
    proposal: typeof deal.proposal === "string" ? deal.proposal : "Service deal",
    messages: Array.isArray(deal.messages) ? deal.messages : [],
    serviceName: typeof deal.serviceName === "string" ? deal.serviceName : "",
  };
}

function summarizeServiceReviews(reviews) {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const review of reviews) distribution[review.rating] += 1;
  return {
    averageRating: reviews.length
      ? Number((reviews.reduce((total, review) => total + review.rating, 0) / reviews.length).toFixed(1))
      : 0,
    reviewCount: reviews.length,
    distribution,
  };
}

async function publicServiceReviews(serviceProviderId, serviceName) {
  const reviews = await listServiceReviews(serviceProviderId, serviceName);
  const publicReviews = await Promise.all(reviews.map(async (review) => {
    const reviewer = await findUserById(review.userId);
    return {
      id: review.id,
      serviceName: review.serviceName,
      rating: review.rating,
      comment: review.comment,
      reviewerName: reviewer?.visibility === "public" ? reviewer.name : "Verified customer",
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  }));
  return { reviews: publicReviews, ...summarizeServiceReviews(reviews) };
}

async function customerCanReviewService(userId, serviceProviderId, serviceName) {
  const deals = await listServiceDeals(userId, serviceProviderId);
  return deals.some((deal) => deal.serviceName === serviceName
    && (deal.status === "accepted" || deal.status === "fulfilled"));
}

function setProviderSession(response, providerId) {
  const token = jwt.sign(
    { sub: providerId, accountType: "serviceProvider" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );
  response.cookie("service_provider_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function validateProvider(input, { includeCredentials }) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const pincode = typeof input.pincode === "string" ? input.pincode.trim() : "";
  const services = Array.isArray(input.services)
    ? [...new Set(input.services.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
  const serviceDetailsInput = input.serviceDetails && typeof input.serviceDetails === "object" && !Array.isArray(input.serviceDetails)
    ? input.serviceDetails
    : {};
  const otherService = typeof input.otherService === "string" ? input.otherService.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const expertise = typeof input.expertise === "string" ? input.expertise.trim() : "";
  const yearsExperience = input.yearsExperience === "" || input.yearsExperience == null
    ? null
    : Number(input.yearsExperience);
  const latitude = input.locationConsent === true ? Number(input.latitude) : null;
  const longitude = input.locationConsent === true ? Number(input.longitude) : null;

  if (!name || name.length > 80) return { error: "Enter your name (up to 80 characters)." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: "Enter a valid email address." };
  if (includeCredentials && !passwordPattern.test(password)) return { error: "Password must be 8–72 characters with no spaces." };
  if (!phonePattern.test(phone)) return { error: "Enter a valid Indian mobile number." };
  if (!pincodePattern.test(pincode)) return { error: "Enter a valid 6-digit Indian pincode." };
  if (services.length < 1 || services.length > indiaServices.length) return { error: "Choose at least one service from the available list." };
  const customService = services.some((service) => service.toLowerCase() === "other");
  if (customService && (!otherService || otherService.length > 80)) {
    return { error: "Describe your other service in up to 80 characters." };
  }
  if (services.some((service) => service.toLowerCase() !== "other" && !indiaServices.includes(service))) {
    return { error: "Choose services from the approved service list." };
  }
  const serviceDetails = {};
  for (const service of services) {
    const details = serviceDetailsInput[service];
    const serviceDescription = typeof details?.description === "string" ? details.description.trim() : "";
    const priceValue = details?.usualPrice === "" || details?.usualPrice == null
      ? null
      : Number(details.usualPrice);
    if (!serviceDescription || serviceDescription.length > 1000) {
      return { error: `Add a short description (up to 1,000 characters) for ${service === "Other" ? otherService : service}.` };
    }
    if (priceValue !== null && (!Number.isFinite(priceValue) || priceValue < 0 || priceValue > 10000000)) {
      return { error: `Enter a valid usual price for ${service === "Other" ? otherService : service}, or leave it blank.` };
    }
    serviceDetails[service] = { description: serviceDescription, usualPrice: priceValue };
  }
  if (description.length > 2000 || expertise.length > 2000) return { error: "Expertise and offering details must be 2,000 characters or fewer." };
  if (yearsExperience !== null && (!Number.isInteger(yearsExperience) || yearsExperience < 0 || yearsExperience > 80)) {
    return { error: "Enter years of experience from 0 to 80." };
  }
  if (
    input.locationConsent === true &&
    (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)
  ) return { error: "The optional location coordinates are invalid." };

  return {
    value: {
      name,
      email,
      password,
      phone,
      pincode,
      services,
      serviceDetails,
      otherService: customService ? otherService : "",
      description,
      expertise,
      yearsExperience,
      location: input.locationConsent === true ? { latitude, longitude } : null,
    },
  };
}

async function getProviderForUser(userId, providerId) {
  const [user, provider] = await Promise.all([
    findUserById(userId),
    findServiceProviderById(providerId),
  ]);
  if (
    !user ||
    !provider ||
    user.pincode.trim().toUpperCase() !== provider.pincode.trim().toUpperCase()
  ) return null;
  return { user, provider };
}

async function getSameAreaProviderPair(providerId, userId) {
  const [provider, user] = await Promise.all([
    findServiceProviderById(providerId),
    findUserById(userId),
  ]);
  if (
    !provider ||
    !user ||
    provider.pincode.trim().toUpperCase() !== user.pincode.trim().toUpperCase()
  ) return null;
  return { provider, user };
}

function isOfferedService(provider, serviceName) {
  return typeof serviceName === "string" &&
    Array.isArray(provider.services) &&
    provider.services.includes(serviceName);
}

function emitServiceMessage(request, message) {
  request.app.get("io")
    ?.to(`service-conversation:${message.userId}:${message.serviceProviderId}`)
    .to(`user:${message.userId}`)
    .to(`service-provider:${message.serviceProviderId}`)
    .emit("service-chat:message", message);
}

function emitServiceDealUpdate(request, deal) {
  request.app.get("io")
    ?.to(`service-conversation:${deal.userId}:${deal.serviceProviderId}`)
    .to(`user:${deal.userId}`)
    .to(`service-provider:${deal.serviceProviderId}`)
    .emit("service-deal:update", deal);
}

async function publicServiceDeal(deal) {
  const provider = await findServiceProviderById(deal.serviceProviderId);
  return provider ? { ...publicDeal(deal), provider: publicProvider(provider) } : null;
}

router.get("/catalog", (_request, response) => response.json({ services: indiaServices }));

router.post("/signup", authLimit, async (request, response, next) => {
  const result = validateProvider(request.body ?? {}, { includeCredentials: true });
  if (result.error) return response.status(400).json({ error: result.error });
  try {
    const { password, ...details } = result.value;
    const passwordHash = await bcrypt.hash(password, 12);
    const provider = await createServiceProvider({ ...details, passwordHash });
    for (const cookieName of ["session", "business_session"]) {
      response.clearCookie(cookieName, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
    }
    setProviderSession(response, provider.id);
    return response.status(201).json({ serviceProvider: publicProvider(provider, true) });
  } catch (error) {
    if (error.name === "DuplicateServiceProviderEmailError") {
      return response.status(409).json({ error: "A service provider account with this email already exists." });
    }
    return next(error);
  }
});

router.post("/signin", authLimit, async (request, response, next) => {
  const { email, password } = request.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || password.length > 72) {
    return response.status(400).json({ error: "Enter your email and password." });
  }
  try {
    const provider = await findServiceProviderByEmail(email.trim().toLowerCase());
    if (!provider || !(await bcrypt.compare(password, provider.passwordHash))) {
      return response.status(401).json({ error: "Email or password is incorrect." });
    }
    for (const cookieName of ["session", "business_session"]) {
      response.clearCookie(cookieName, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
    }
    setProviderSession(response, provider.id);
    return response.json({ serviceProvider: publicProvider(provider, true) });
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

router.get("/me", requireServiceProviderAuth, async (request, response, next) => {
  try {
    const provider = await findServiceProviderById(request.serviceProviderId);
    if (!provider) return response.status(401).json({ error: "Your service provider account could not be found." });
    return response.json({ serviceProvider: publicProvider(provider, true) });
  } catch (error) {
    return next(error);
  }
});

router.put("/profile", requireServiceProviderAuth, async (request, response, next) => {
  const result = validateProvider({ ...request.body, password: "not-used" }, { includeCredentials: false });
  if (result.error) return response.status(400).json({ error: result.error });
  try {
    const { email, name, phone, pincode, services, serviceDetails, otherService, description, expertise, yearsExperience, location } = result.value;
    const existing = await findServiceProviderById(request.serviceProviderId);
    if (!existing) return response.status(404).json({ error: "Your service provider account could not be found." });
    if (email !== existing.email) return response.status(400).json({ error: "Email address changes are not available yet." });
    const provider = await updateServiceProvider(request.serviceProviderId, {
      name,
      phone,
      pincode,
      services,
      serviceDetails,
      otherService,
      description,
      expertise,
      yearsExperience,
      ...(location ? { location } : {}),
    });
    return response.json({ serviceProvider: publicProvider(provider, true) });
  } catch (error) {
    return next(error);
  }
});

router.get("/directory", requireAuth, async (request, response, next) => {
  try {
    const user = await findUserById(request.userId);
    if (!user) return response.status(401).json({ error: "Please sign in again." });
    const query = typeof request.query.search === "string" ? request.query.search.trim().slice(0, 120).toLocaleLowerCase() : "";
    const requestedService = typeof request.query.service === "string" ? request.query.service.trim() : "";
    const providers = await findServiceProvidersByPincode(user.pincode);
    const matched = providers.filter((provider) => {
      if (requestedService && !isOfferedService(provider, requestedService)) return false;
      if (!query) return true;
      const fields = [
        provider.name,
        provider.description,
        provider.expertise,
        provider.otherService,
        ...(Array.isArray(provider.services) ? provider.services : []),
        ...Object.values(provider.serviceDetails || {}).map((details) => details?.description),
      ];
      return fields.some((field) => typeof field === "string" && field.toLocaleLowerCase().includes(query));
    }).sort((left, right) => left.name.localeCompare(right.name)).slice(0, 100);
    const serviceProviders = await Promise.all(matched.map(async (provider) => {
      const reviews = await listServiceReviews(provider.id);
      const reviewsByService = new Map();
      for (const review of reviews) {
        const serviceReviews = reviewsByService.get(review.serviceName) || [];
        serviceReviews.push(review);
        reviewsByService.set(review.serviceName, serviceReviews);
      }
      const serviceRatingSummaries = Object.fromEntries(
        (Array.isArray(provider.services) ? provider.services : [])
          .map((service) => [service, summarizeServiceReviews(reviewsByService.get(service) || [])]),
      );
      return { ...publicProvider(provider), serviceRatingSummaries };
    }));
    return response.json({ serviceProviders });
  } catch (error) {
    return next(error);
  }
});

router.get("/reviews", requireServiceProviderAuth, async (request, response, next) => {
  try {
    const provider = await findServiceProviderById(request.serviceProviderId);
    if (!provider) return response.status(401).json({ error: "Your service provider account could not be found." });
    const reviews = await listServiceReviews(provider.id);
    const reviewsByService = new Map();
    for (const review of reviews) {
      const serviceReviews = reviewsByService.get(review.serviceName) || [];
      serviceReviews.push(review);
      reviewsByService.set(review.serviceName, serviceReviews);
    }
    const serviceNames = new Set([
      ...(Array.isArray(provider.services) ? provider.services : []),
      ...reviews.map((review) => review.serviceName),
    ]);
    const serviceReviews = await Promise.all([...serviceNames].map(async (serviceName) => {
      const serviceReviewList = reviewsByService.get(serviceName) || [];
      const publicReviews = await Promise.all(serviceReviewList.map(async (review) => {
        const customer = await findUserById(review.userId);
        return {
          id: review.id,
          rating: review.rating,
          comment: review.comment,
          reviewerName: customer?.name || "Customer",
          createdAt: review.createdAt,
          updatedAt: review.updatedAt,
        };
      }));
      return {
        serviceName,
        reviews: publicReviews,
        ...summarizeServiceReviews(serviceReviewList),
      };
    }));
    return response.json({ serviceReviews });
  } catch (error) {
    return next(error);
  }
});

router.get("/providers/:providerId/reviews", requireAuth, async (request, response, next) => {
  const serviceName = typeof request.query.serviceName === "string" ? request.query.serviceName.trim() : "";
  if (!serviceName) return response.status(400).json({ error: "Choose a service to view its reviews." });
  try {
    const pair = await getProviderForUser(request.userId, request.params.providerId);
    if (!pair) return response.status(404).json({ error: "That service provider is not available in your area." });
    if (!isOfferedService(pair.provider, serviceName)) {
      return response.status(404).json({ error: "That service is not offered by this provider." });
    }
    const [reviewSummary, eligible, reviews] = await Promise.all([
      publicServiceReviews(pair.provider.id, serviceName),
      customerCanReviewService(pair.user.id, pair.provider.id, serviceName),
      listServiceReviews(pair.provider.id, serviceName),
    ]);
    return response.json({
      ...reviewSummary,
      canReview: eligible,
      myReview: reviews.find((review) => review.userId === pair.user.id) || null,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/providers/:providerId/reviews", requireAuth, async (request, response, next) => {
  const serviceName = typeof request.body?.serviceName === "string" ? request.body.serviceName.trim() : "";
  const rating = request.body?.rating;
  const comment = typeof request.body?.comment === "string" ? request.body.comment.trim() : "";
  if (!serviceName) return response.status(400).json({ error: "Choose a service for this review." });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return response.status(400).json({ error: "Choose a rating from 1 to 5 stars." });
  }
  if (comment.length > 1500) return response.status(400).json({ error: "Review comments must be 1,500 characters or fewer." });
  try {
    const pair = await getProviderForUser(request.userId, request.params.providerId);
    if (!pair) return response.status(404).json({ error: "That service provider is not available in your area." });
    if (!isOfferedService(pair.provider, serviceName)) {
      return response.status(404).json({ error: "That service is not offered by this provider." });
    }
    if (!(await customerCanReviewService(pair.user.id, pair.provider.id, serviceName))) {
      return response.status(403).json({ error: "An accepted or fulfilled deal for this service is required before reviewing it." });
    }
    const savedReview = await saveServiceReview({
      serviceProviderId: pair.provider.id,
      serviceName,
      userId: pair.user.id,
      rating,
      comment,
    });
    const summary = await publicServiceReviews(pair.provider.id, serviceName);
    return response.json({
      ...summary,
      canReview: true,
      myReview: {
        id: savedReview.id,
        serviceName: savedReview.serviceName,
        rating: savedReview.rating,
        comment: savedReview.comment,
        reviewerName: pair.user.name,
        createdAt: savedReview.createdAt,
        updatedAt: savedReview.updatedAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/my-conversations", requireAuth, async (request, response, next) => {
  try {
    const [messages, deals] = await Promise.all([
      listServiceMessagesForUser(request.userId),
      listServiceDealsForUser(request.userId),
    ]);
    const providerIds = new Set([
      ...messages.map((message) => message.serviceProviderId),
      ...deals.map((deal) => deal.serviceProviderId),
    ]);
    const conversations = await Promise.all([...providerIds].map(async (providerId) => {
      const pair = await getProviderForUser(request.userId, providerId);
      if (!pair) return null;
      const providerMessages = messages.filter((message) => message.serviceProviderId === providerId);
      const providerDeals = deals.filter((deal) => deal.serviceProviderId === providerId);
      const latestMessage = providerMessages.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      const latestDeal = providerDeals.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      const lastMessage = !latestMessage || (latestDeal && latestDeal.updatedAt > latestMessage.createdAt)
        ? {
          content: (Array.isArray(latestDeal?.messages) ? latestDeal.messages.at(-1)?.content : null) || latestDeal?.proposal,
          serviceName: latestDeal.serviceName || "",
          createdAt: latestDeal.updatedAt,
        }
        : latestMessage;
      return { serviceProvider: publicProvider(pair.provider), lastMessage };
    }));
    return response.json({
      conversations: conversations.filter(Boolean).sort((left, right) =>
        (right.lastMessage?.createdAt || "").localeCompare(left.lastMessage?.createdAt || ""),
      ),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/providers/:providerId/messages", requireAuth, async (request, response, next) => {
  try {
    const pair = await getProviderForUser(request.userId, request.params.providerId);
    if (!pair || pair.provider.isVisible === false) {
      const provider = await findServiceProviderById(request.params.providerId);
      if (!pair || !provider) return response.status(404).json({ error: "That service provider is not available in your area." });
      const [messages, deals] = await Promise.all([
        listServiceConversation(pair.user.id, pair.provider.id),
        listServiceDeals(pair.user.id, pair.provider.id),
      ]);
      if (messages.length === 0 && deals.length === 0) {
        return response.status(404).json({ error: "That service provider is not accepting new chats." });
      }
    }
    const messages = await listServiceConversation(pair.user.id, pair.provider.id);
    return response.json({ messages });
  } catch (error) {
    return next(error);
  }
});

router.post("/providers/:providerId/messages", requireAuth, messageLimit, async (request, response, next) => {
  const content = typeof request.body?.content === "string" ? request.body.content.trim() : "";
  if (!content || content.length > 2000) return response.status(400).json({ error: "Messages must be between 1 and 2,000 characters." });
  try {
    const pair = await getProviderForUser(request.userId, request.params.providerId);
    if (!pair) return response.status(404).json({ error: "That service provider is not available in your area." });
    const serviceName = typeof request.body?.serviceName === "string" ? request.body.serviceName.trim() : "";
    if (!isOfferedService(pair.provider, serviceName)) {
      return response.status(400).json({ error: "Choose one of this provider’s listed services before sending a message." });
    }
    const existingMessages = await listServiceConversation(pair.user.id, pair.provider.id);
    if (pair.provider.isVisible === false && existingMessages.length === 0) {
      return response.status(404).json({ error: "That service provider is not accepting new chats." });
    }
    const message = await createServiceMessage({
      userId: pair.user.id,
      serviceProviderId: pair.provider.id,
      senderType: "user",
      serviceName,
      content,
    });
    emitServiceMessage(request, message);
    return response.status(201).json({ message });
  } catch (error) {
    return next(error);
  }
});

router.get("/conversations", requireServiceProviderAuth, async (request, response, next) => {
  try {
    const [messages, deals] = await Promise.all([
      listServiceMessagesForProvider(request.serviceProviderId),
      listServiceDealsForProvider(request.serviceProviderId),
    ]);
    const userIds = new Set([...messages.map((message) => message.userId), ...deals.map((deal) => deal.userId)]);
    const conversations = await Promise.all([...userIds].map(async (userId) => {
      const pair = await getSameAreaProviderPair(request.serviceProviderId, userId);
      if (!pair) return null;
      const latestMessage = messages.filter((message) => message.userId === userId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      const latestDeal = deals.filter((deal) => deal.userId === userId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      const lastMessage = !latestMessage || (latestDeal && latestDeal.updatedAt > latestMessage.createdAt)
        ? {
          content: (Array.isArray(latestDeal?.messages) ? latestDeal.messages.at(-1)?.content : null) || latestDeal?.proposal,
          serviceName: latestDeal.serviceName || "",
          createdAt: latestDeal.updatedAt,
        }
        : latestMessage;
      return { user: { id: pair.user.id, name: pair.user.name }, lastMessage };
    }));
    return response.json({
      conversations: conversations.filter(Boolean).sort((left, right) =>
        (right.lastMessage?.createdAt || "").localeCompare(left.lastMessage?.createdAt || ""),
      ),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/conversations/:userId/messages", requireServiceProviderAuth, async (request, response, next) => {
  try {
    const pair = await getSameAreaProviderPair(request.serviceProviderId, request.params.userId);
    if (!pair) return response.status(404).json({ error: "That customer is not available in your area." });
    const messages = await listServiceConversation(pair.user.id, pair.provider.id);
    const deals = await listServiceDeals(pair.user.id, pair.provider.id);
    if (messages.length === 0 && deals.length === 0) {
      return response.status(404).json({ error: "The customer must start the service conversation before you can reply." });
    }
    return response.json({ user: { id: pair.user.id, name: pair.user.name }, messages });
  } catch (error) {
    return next(error);
  }
});

router.post("/conversations/:userId/messages", requireServiceProviderAuth, messageLimit, async (request, response, next) => {
  const content = typeof request.body?.content === "string" ? request.body.content.trim() : "";
  if (!content || content.length > 2000) return response.status(400).json({ error: "Messages must be between 1 and 2,000 characters." });
  try {
    const pair = await getSameAreaProviderPair(request.serviceProviderId, request.params.userId);
    if (!pair) return response.status(404).json({ error: "That customer is not available in your area." });
    const serviceName = typeof request.body?.serviceName === "string" ? request.body.serviceName.trim() : "";
    if (!isOfferedService(pair.provider, serviceName)) {
      return response.status(400).json({ error: "Choose one of your listed services before sending a message." });
    }
    const existing = await listServiceConversation(pair.user.id, pair.provider.id);
    const deals = await listServiceDeals(pair.user.id, pair.provider.id);
    if (existing.length === 0 && deals.length === 0) {
      return response.status(404).json({ error: "The customer must start the service conversation before you can reply." });
    }
    const message = await createServiceMessage({
      userId: pair.user.id,
      serviceProviderId: pair.provider.id,
      senderType: "serviceProvider",
      serviceName,
      content,
    });
    emitServiceMessage(request, message);
    return response.status(201).json({ message });
  } catch (error) {
    return next(error);
  }
});

router.get("/providers/:providerId/deals", requireAuth, async (request, response, next) => {
  try {
    const pair = await getProviderForUser(request.userId, request.params.providerId);
    if (!pair) return response.status(404).json({ error: "That service provider is not available in your area." });
    return response.json({ deals: (await listServiceDeals(pair.user.id, pair.provider.id)).map(publicDeal) });
  } catch (error) {
    return next(error);
  }
});

router.post("/providers/:providerId/deals", requireAuth, messageLimit, async (request, response, next) => {
  const proposal = typeof request.body?.proposal === "string" ? request.body.proposal.trim() : "";
  if (!proposal || proposal.length > 2000) return response.status(400).json({ error: "Describe the proposed service deal in 1 to 2,000 characters." });
  try {
    const pair = await getProviderForUser(request.userId, request.params.providerId);
    if (!pair || pair.provider.isVisible === false) {
      return response.status(404).json({ error: "That service provider is not available in your area." });
    }
    const serviceName = typeof request.body?.serviceName === "string" ? request.body.serviceName.trim() : "";
    if (!isOfferedService(pair.provider, serviceName)) {
      return response.status(400).json({ error: "Choose one of this provider’s listed services before proposing a deal." });
    }
    const deal = await createBusinessDeal({
      userId: pair.user.id,
      businessId: pair.provider.id,
      serviceProviderId: pair.provider.id,
      creatorType: "user",
      serviceName,
      proposal,
    });
    emitServiceDealUpdate(request, deal);
    return response.status(201).json({ deal });
  } catch (error) {
    return next(error);
  }
});

router.get("/conversations/:userId/deals", requireServiceProviderAuth, async (request, response, next) => {
  try {
    const pair = await getSameAreaProviderPair(request.serviceProviderId, request.params.userId);
    if (!pair) return response.status(404).json({ error: "That customer is not available in your area." });
    return response.json({ deals: (await listServiceDeals(pair.user.id, pair.provider.id)).map(publicDeal) });
  } catch (error) {
    return next(error);
  }
});

router.post("/conversations/:userId/deals", requireServiceProviderAuth, messageLimit, async (request, response, next) => {
  const proposal = typeof request.body?.proposal === "string" ? request.body.proposal.trim() : "";
  if (!proposal || proposal.length > 2000) return response.status(400).json({ error: "Describe the proposed service deal in 1 to 2,000 characters." });
  try {
    const pair = await getSameAreaProviderPair(request.serviceProviderId, request.params.userId);
    if (!pair) return response.status(404).json({ error: "That customer is not available in your area." });
    const serviceName = typeof request.body?.serviceName === "string" ? request.body.serviceName.trim() : "";
    if (!isOfferedService(pair.provider, serviceName)) {
      return response.status(400).json({ error: "Choose one of your listed services before proposing a deal." });
    }
    const [messages, deals] = await Promise.all([
      listServiceConversation(pair.user.id, pair.provider.id),
      listServiceDeals(pair.user.id, pair.provider.id),
    ]);
    if (messages.length === 0 && deals.length === 0) {
      return response.status(404).json({ error: "The customer must start the service conversation before you can propose a deal." });
    }
    const deal = await createBusinessDeal({
      userId: pair.user.id,
      businessId: pair.provider.id,
      serviceProviderId: pair.provider.id,
      creatorType: "serviceProvider",
      serviceName,
      proposal,
    });
    emitServiceDealUpdate(request, deal);
    return response.status(201).json({ deal });
  } catch (error) {
    return next(error);
  }
});

router.get("/deals/active", requireAuth, async (request, response, next) => {
  try {
    const deals = (await listServiceDealsForUser(request.userId))
      .filter((deal) => deal.status === "pending" || deal.status === "accepted");
    const activeDeals = await Promise.all(deals.map(async (deal) => {
      const pair = await getProviderForUser(request.userId, deal.serviceProviderId);
      return pair ? publicServiceDeal(deal) : null;
    }));
    return response.json({ deals: activeDeals.filter(Boolean) });
  } catch (error) {
    return next(error);
  }
});

router.get("/provider-deals/active", requireServiceProviderAuth, async (request, response, next) => {
  try {
    const deals = (await listServiceDealsForProvider(request.serviceProviderId))
      .filter((deal) => deal.status === "pending" || deal.status === "accepted");
    const activeDeals = await Promise.all(deals.map(async (deal) => {
      const pair = await getSameAreaProviderPair(request.serviceProviderId, deal.userId);
      return pair ? { ...publicDeal(deal), customer: { id: pair.user.id, name: pair.user.name } } : null;
    }));
    return response.json({ deals: activeDeals.filter(Boolean) });
  } catch (error) {
    return next(error);
  }
});

router.post("/deals/:dealId/status", requireAuth, async (request, response, next) => {
  const action = request.body?.action;
  if (!["accept", "pass", "fulfill"].includes(action)) return response.status(400).json({ error: "Choose an available deal action." });
  try {
    const deal = await findBusinessDealById(request.params.dealId);
    const pair = deal?.serviceProviderId ? await getProviderForUser(request.userId, deal.serviceProviderId) : null;
    if (!pair || deal.userId !== request.userId) return response.status(404).json({ error: "That service deal could not be found." });
    if ((action === "accept" || action === "pass") && (deal.status !== "pending" || deal.creatorType === "user")) {
      return response.status(409).json({ error: "This proposal is no longer awaiting your response." });
    }
    if (action === "fulfill" && deal.status !== "accepted") return response.status(409).json({ error: "Only an accepted deal can be marked fulfilled." });
    const updatedDeal = await updateBusinessDealStatus(deal.id, action, "user");
    if (!updatedDeal) return response.status(409).json({ error: "This deal has already changed and can no longer be updated." });
    emitServiceDealUpdate(request, updatedDeal);
    return response.json({ deal: updatedDeal });
  } catch (error) {
    return next(error);
  }
});

router.post("/provider-deals/:dealId/status", requireServiceProviderAuth, async (request, response, next) => {
  const action = request.body?.action;
  if (!["accept", "pass", "fulfill"].includes(action)) return response.status(400).json({ error: "Choose an available deal action." });
  try {
    const deal = await findBusinessDealById(request.params.dealId);
    if (!deal || deal.serviceProviderId !== request.serviceProviderId) return response.status(404).json({ error: "That service deal could not be found." });
    const pair = await getSameAreaProviderPair(request.serviceProviderId, deal.userId);
    if (!pair) return response.status(404).json({ error: "That customer is not available in your area." });
    if ((action === "accept" || action === "pass") && (deal.status !== "pending" || deal.creatorType === "serviceProvider")) {
      return response.status(409).json({ error: "This proposal is no longer awaiting your response." });
    }
    if (action === "fulfill" && deal.status !== "accepted") return response.status(409).json({ error: "Only an accepted deal can be marked fulfilled." });
    const updatedDeal = await updateBusinessDealStatus(deal.id, action, "serviceProvider");
    if (!updatedDeal) return response.status(409).json({ error: "This deal has already changed and can no longer be updated." });
    emitServiceDealUpdate(request, updatedDeal);
    return response.json({ deal: updatedDeal });
  } catch (error) {
    return next(error);
  }
});

router.post("/deals/:dealId/messages", requireAuth, messageLimit, async (request, response, next) => {
  const content = typeof request.body?.content === "string" ? request.body.content.trim() : "";
  if (!content || content.length > 2000) return response.status(400).json({ error: "Messages must be between 1 and 2,000 characters." });
  try {
    const deal = await findBusinessDealById(request.params.dealId);
    const pair = deal?.serviceProviderId ? await getProviderForUser(request.userId, deal.serviceProviderId) : null;
    if (!pair || deal.userId !== request.userId) return response.status(404).json({ error: "That service deal could not be found." });
    const result = await addBusinessDealMessage(deal.id, "user", content);
    if (!result) return response.status(409).json({ error: "Deal chat is available after the proposal is accepted." });
    emitServiceDealUpdate(request, result.deal);
    return response.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/provider-deals/:dealId/messages", requireServiceProviderAuth, messageLimit, async (request, response, next) => {
  const content = typeof request.body?.content === "string" ? request.body.content.trim() : "";
  if (!content || content.length > 2000) return response.status(400).json({ error: "Messages must be between 1 and 2,000 characters." });
  try {
    const deal = await findBusinessDealById(request.params.dealId);
    if (!deal || deal.serviceProviderId !== request.serviceProviderId) return response.status(404).json({ error: "That service deal could not be found." });
    const pair = await getSameAreaProviderPair(request.serviceProviderId, deal.userId);
    if (!pair) return response.status(404).json({ error: "That customer is not available in your area." });
    const result = await addBusinessDealMessage(deal.id, "serviceProvider", content);
    if (!result) return response.status(409).json({ error: "Deal chat is available after the proposal is accepted." });
    emitServiceDealUpdate(request, result.deal);
    return response.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

router.get("/provider-deals", requireServiceProviderAuth, async (request, response, next) => {
  try {
    const deals = await listServiceDealsForProvider(request.serviceProviderId);
    const availableDeals = await Promise.all(deals.map(async (deal) =>
      await getSameAreaProviderPair(request.serviceProviderId, deal.userId) ? deal : null,
    ));
    return response.json({ deals: availableDeals.filter(Boolean).map(publicDeal) });
  } catch (error) {
    return next(error);
  }
});

router.get("/provider-conversations", requireServiceProviderAuth, async (request, response, next) => {
  try {
    const messages = await listServiceMessagesForProvider(request.serviceProviderId);
    const deals = await listServiceDealsForProvider(request.serviceProviderId);
    const userIds = new Set([...messages.map((message) => message.userId), ...deals.map((deal) => deal.userId)]);
    const conversations = await Promise.all([...userIds].map(async (userId) =>
      await getSameAreaProviderPair(request.serviceProviderId, userId) ? userId : null,
    ));
    return response.json({ conversations: conversations.filter(Boolean) });
  } catch (error) {
    return next(error);
  }
});

export default router;
