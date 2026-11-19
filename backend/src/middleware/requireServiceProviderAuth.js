import jwt from "jsonwebtoken";
import { findServiceProviderById } from "../models/ServiceProvider.js";

export async function requireServiceProviderAuth(request, response, next) {
  const token = request.cookies?.service_provider_session;
  if (!token) {
    return response.status(401).json({ error: "Please sign in to your service provider account." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (
      typeof payload === "string" ||
      typeof payload.sub !== "string" ||
      payload.accountType !== "serviceProvider"
    ) {
      return response.status(401).json({ error: "Your service provider session is invalid. Please sign in again." });
    }
    const provider = await findServiceProviderById(payload.sub);
    if (!provider) {
      return response.status(401).json({ error: "Your service provider account could not be found." });
    }
    request.serviceProviderId = provider.id;
    return next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return response.status(401).json({ error: "Your service provider session has expired. Please sign in again." });
    }
    return next(error);
  }
}
