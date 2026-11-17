import { Router } from "express";
import { rateLimit } from "express-rate-limit";

const router = Router();
const locationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many location lookups. Please enter your pincode manually." },
});

router.get("/reverse", locationRateLimit, async (request, response) => {
  const lat = Number(request.query.lat);
  const lon = Number(request.query.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    return response.status(400).json({ error: "A valid latitude and longitude are required." });
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    return response.status(503).json({
      error: "Automatic pincode lookup isn't configured yet. Please enter your pincode manually.",
    });
  }

  try {
    const url = new URL("https://api.geoapify.com/v1/geocode/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("format", "json");
    url.searchParams.set("apiKey", apiKey);

    const result = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!result.ok) {
      return response.status(502).json({ error: "Automatic pincode lookup is unavailable. Please enter it manually." });
    }
    const data = await result.json();
    const pincode = data.results?.[0]?.postcode;
    if (typeof pincode !== "string" || !pincode.trim()) {
      return response.json({ pincode: null });
    }

    return response.json({ pincode: pincode.trim() });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return response.status(504).json({ error: "Pincode lookup timed out. Please enter it manually." });
    }
    console.error("Geoapify reverse-geocoding request failed:", error.name);
    return response.status(502).json({ error: "Automatic pincode lookup failed. Please enter it manually." });
  }
});

export default router;
