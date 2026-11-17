import jwt from "jsonwebtoken";

export function requireAuth(request, response, next) {
  const token = request.cookies?.session;

  if (!token) {
    return response.status(401).json({ error: "Please sign in to continue." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (typeof payload === "string" || typeof payload.sub !== "string") {
      return response.status(401).json({ error: "Your session is invalid. Please sign in again." });
    }
    request.userId = payload.sub;
    return next();
  } catch {
    return response.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}
