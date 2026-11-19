import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataFile = fileURLToPath(new URL("../../data/business-products.json", import.meta.url));
let operationQueue = Promise.resolve();

async function readProducts() {
  try {
    const products = JSON.parse(await readFile(dataFile, "utf8"));
    if (!Array.isArray(products)) throw new Error("The business products file must contain a JSON array.");
    return products;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeProducts(products) {
  await mkdir(dirname(dataFile), { recursive: true });
  const temporaryFile = join(dirname(dataFile), `business-products.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryFile, `${JSON.stringify(products, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryFile, dataFile);
  } catch (error) {
    try {
      await rm(temporaryFile, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Failed to write business products.");
    }
    throw error;
  }
}

function withProducts(operation) {
  const result = operationQueue.then(async () => {
    const products = await readProducts();
    const operationResult = await operation(products);
    if (operationResult.write) await writeProducts(products);
    return operationResult.value;
  });
  operationQueue = result.catch(() => {});
  return result;
}

export async function initializeBusinessProductStore() {
  return withProducts(async () => {
    try {
      await readFile(dataFile);
      return { value: undefined, write: false };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { value: undefined, write: true };
    }
  });
}

export function listBusinessProducts(businessId) {
  return withProducts((products) => ({
    value: products
      .filter((product) => product.businessId === businessId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    write: false,
  }));
}

export function findBusinessProduct(productId) {
  return withProducts((products) => ({
    value: products.find((product) => product.id === productId) || null,
    write: false,
  }));
}

export function reserveBusinessProductStock(businessId, requestedItems) {
  return withProducts((products) => {
    const orderItems = [];
    const reservations = [];
    let orderTotalCents = 0;
    for (const { productId, quantity } of requestedItems) {
      const product = products.find((item) => item.id === productId && item.businessId === businessId);
      if (!product || !product.available) {
        return {
          value: { error: "A product in your cart is no longer available. Refresh the catalog and try again." },
          write: false,
        };
      }
      if (product.trackInventory === true && (!Number.isInteger(product.stockQuantity) || product.stockQuantity < quantity)) {
        return {
          value: { error: `${product.name} does not have enough stock for that quantity. Refresh the catalog and try again.` },
          write: false,
        };
      }

      const originalPriceCents = Math.round(product.price * 100);
      const timedDiscountActive = product.discountType === "timed"
        && Number.isFinite(Date.parse(product.discountEndsAt))
        && Date.parse(product.discountEndsAt) > Date.now();
      const discountPercent = product.discountType === "ongoing" || timedDiscountActive
        ? product.discountPercent
        : 0;
      const unitPriceCents = discountPercent > 0
        ? Math.round(originalPriceCents * (100 - discountPercent) / 100)
        : originalPriceCents;
      const lineTotalCents = unitPriceCents * quantity;
      orderTotalCents += lineTotalCents;
      orderItems.push({
        productId: product.id,
        name: product.name,
        quantity,
        originalUnitPrice: originalPriceCents / 100,
        unitPrice: unitPriceCents / 100,
        discountPercent,
        lineTotal: lineTotalCents / 100,
      });

      if (product.trackInventory === true) {
        product.stockQuantity -= quantity;
        product.updatedAt = new Date().toISOString();
        reservations.push({ productId: product.id, quantity });
      }
    }

    return {
      value: {
        orderItems,
        orderTotal: orderTotalCents / 100,
        reservations,
      },
      write: reservations.length > 0,
    };
  });
}

export function restoreBusinessProductStock(businessId, reservations) {
  return withProducts((products) => {
    let restored = false;
    for (const { productId, quantity } of reservations) {
      const product = products.find((item) => item.id === productId && item.businessId === businessId);
      if (product?.trackInventory === true) {
        product.stockQuantity += quantity;
        product.updatedAt = new Date().toISOString();
        restored = true;
      }
    }
    return { value: undefined, write: restored };
  });
}

export function createBusinessProduct({
  businessId,
  name,
  price,
  description,
  photo,
  trackInventory = false,
  stockQuantity = null,
}) {
  return withProducts((products) => {
    const now = new Date().toISOString();
    const product = {
      id: randomUUID(),
      businessId,
      name,
      price,
      description,
      photo,
      available: true,
      trackInventory,
      stockQuantity: trackInventory ? stockQuantity : null,
      createdAt: now,
      updatedAt: now,
    };
    products.push(product);
    return { value: product, write: true };
  });
}

export function updateBusinessProduct(productId, businessId, changes) {
  return withProducts((products) => {
    const product = products.find((item) => item.id === productId && item.businessId === businessId);
    if (!product) return { value: null, write: false };
    const previousPhoto = product.photo;
    Object.assign(product, changes, { updatedAt: new Date().toISOString() });
    return { value: { product, previousPhoto }, write: true };
  });
}

export function deleteBusinessProduct(productId, businessId) {
  return withProducts((products) => {
    const index = products.findIndex((item) => item.id === productId && item.businessId === businessId);
    if (index < 0) return { value: null, write: false };
    const [product] = products.splice(index, 1);
    return { value: product, write: true };
  });
}
