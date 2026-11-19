import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataFile = fileURLToPath(new URL("../../data/service-reviews.json", import.meta.url));
let operationQueue = Promise.resolve();

async function readReviews() {
  try {
    const reviews = JSON.parse(await readFile(dataFile, "utf8"));
    if (!Array.isArray(reviews)) throw new Error("The service reviews file must contain a JSON array.");
    return reviews;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeReviews(reviews) {
  await mkdir(dirname(dataFile), { recursive: true });
  const temporaryFile = join(dirname(dataFile), `service-reviews.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryFile, `${JSON.stringify(reviews, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryFile, dataFile);
  } catch (error) {
    try {
      await rm(temporaryFile, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Failed to write service reviews.");
    }
    throw error;
  }
}

function withReviews(operation) {
  const result = operationQueue.then(async () => {
    const reviews = await readReviews();
    const operationResult = await operation(reviews);
    if (operationResult.write) await writeReviews(reviews);
    return operationResult.value;
  });
  operationQueue = result.catch(() => {});
  return result;
}

export async function initializeServiceReviewStore() {
  return withReviews(async () => {
    try {
      await readFile(dataFile);
      return { value: undefined, write: false };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { value: undefined, write: true };
    }
  });
}

export function listServiceReviews(serviceProviderId, serviceName) {
  return withReviews((reviews) => ({
    value: reviews
      .filter((review) => review.serviceProviderId === serviceProviderId
        && (serviceName === undefined || review.serviceName === serviceName))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    write: false,
  }));
}

export function saveServiceReview({ serviceProviderId, serviceName, userId, rating, comment }) {
  return withReviews((reviews) => {
    const now = new Date().toISOString();
    const existing = reviews.find((review) =>
      review.serviceProviderId === serviceProviderId
      && review.serviceName === serviceName
      && review.userId === userId,
    );
    if (existing) {
      existing.rating = rating;
      existing.comment = comment;
      existing.updatedAt = now;
      return { value: existing, write: true };
    }

    const review = {
      id: randomUUID(),
      serviceProviderId,
      serviceName,
      userId,
      rating,
      comment,
      createdAt: now,
      updatedAt: now,
    };
    reviews.push(review);
    return { value: review, write: true };
  });
}
