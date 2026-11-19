import jwt from "jsonwebtoken";
import { findBusinessById } from "../models/Business.js";

export async function requireBusinessAuth(request, response, next) {
  const token = request.cookies?.business_session;
  if (!token) {
    return response.status(401).json({ error: "Please sign in to your business account." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (typeof payload === "string" || typeof payload.sub !== "string" || payload.accountType !== "business") {
      return response.status(401).json({ error: "Your business session is invalid. Please sign in again." });
    }
    const business = await findBusinessById(payload.sub);
    if (!business) {
      return response.status(401).json({ error: "Your business account could not be found." });
    }
    request.businessId = business.id;
    return next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return response.status(401).json({ error: "Your business session has expired. Please sign in again." });
    }
    return next(error);
  }
}
