import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataFile = fileURLToPath(new URL("../../data/businesses.json", import.meta.url));
let operationQueue = Promise.resolve();

async function readBusinesses() {
  try {
    const contents = await readFile(dataFile, "utf8");
    const businesses = JSON.parse(contents);
    if (!Array.isArray(businesses)) {
      throw new Error("The businesses data file must contain a JSON array.");
    }
    return businesses;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeBusinesses(businesses) {
  await mkdir(dirname(dataFile), { recursive: true });
  const temporaryFile = join(dirname(dataFile), `businesses.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryFile, `${JSON.stringify(businesses, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryFile, dataFile);
  } catch (error) {
    try {
      await rm(temporaryFile, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Failed to write local business accounts.");
    }
    throw error;
  }
}

function withBusinesses(operation) {
  const result = operationQueue.then(async () => {
    const businesses = await readBusinesses();
    const operationResult = await operation(businesses);
    if (operationResult.write) await writeBusinesses(businesses);
    return operationResult.value;
  });
  operationQueue = result.catch(() => {});
  return result;
}

export async function initializeBusinessStore() {
  return withBusinesses(async () => {
    try {
      await readFile(dataFile);
      return { value: undefined, write: false };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { value: undefined, write: true };
    }
  });
}

export function createBusiness(businessDetails) {
  return withBusinesses((businesses) => {
    if (businesses.some((business) => business.email === businessDetails.email)) {
      const error = new Error("An account with this email already exists.");
      error.name = "DuplicateBusinessEmailError";
      throw error;
    }
    const business = {
      id: randomUUID(),
      isVisible: true,
      ...businessDetails,
      createdAt: new Date().toISOString(),
    };
    businesses.push(business);
    return { value: business, write: true };
  });
}

export function findBusinessByEmail(email) {
  return withBusinesses((businesses) => ({
    value: businesses.find((business) => business.email === email) ?? null,
    write: false,
  }));
}

export function findBusinessById(id) {
  return withBusinesses((businesses) => ({
    value: businesses.find((business) => business.id === id) ?? null,
    write: false,
  }));
}

export function findBusinessesByPincode(pincode) {
  const normalizedPincode = pincode.trim().toUpperCase();
  return withBusinesses((businesses) => ({
    value: businesses.filter(
      (business) =>
        business.isVisible !== false &&
        typeof business.pincode === "string" &&
        business.pincode.trim().toUpperCase() === normalizedPincode,
    ),
    write: false,
  }));
}

export function updateBusinessPhotos(id, photos) {
  return withBusinesses((businesses) => {
    const business = businesses.find((item) => item.id === id);
    if (!business) return { value: null, write: false };
    const previousPhotos = business.photos || [];
    business.photos = photos;
    return { value: { business, previousPhotos }, write: true };
  });
}

export function updateBusinessVisibility(id, isVisible) {
  return withBusinesses((businesses) => {
    const business = businesses.find((item) => item.id === id);
    if (!business) return { value: null, write: false };
    business.isVisible = isVisible;
    return { value: business, write: true };
  });
}
