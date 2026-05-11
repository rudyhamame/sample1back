const normalizeGalleryVisibility = (visibility) => {
  const normalizedVisibility = String(visibility || "")
    .trim()
    .toLowerCase();

  if (normalizedVisibility === "private") {
    return "me";
  }

  return ["public", "me", "hidden"].includes(normalizedVisibility)
    ? normalizedVisibility
    : "public";
};

const normalizeStoredGalleryImage = (image) => {
  if (!image) {
    return null;
  }

  const identity = image?.identity || {};
  const url = String(image?.url || image?.secure_url || identity?.url || "").trim();
  const publicId = String(
    image?.publicId ||
      image?.public_id ||
      identity?.publicId ||
      identity?.fileName ||
      "",
  ).trim();
  const mimeType = String(
    image?.mimeType || image?.mime_type || identity?.mimeType || "",
  ).trim();
  const normalizedResourceType = String(
    image?.resourceType ||
      image?.resource_type ||
      (mimeType.startsWith("video/") ? "video" : "") ||
      (mimeType && !mimeType.startsWith("image/") ? "raw" : "") ||
      "image",
  )
    .trim()
    .toLowerCase();
  const resourceType =
    normalizedResourceType === "video"
      ? "video"
      : normalizedResourceType === "raw"
        ? "raw"
        : "image";

  if (!url || !publicId) {
    return null;
  }

  const width = Number(image?.width) || 0;
  const height = Number(image?.height) || 0;
  const bytes = Number(image?.bytes) || 0;
  const duration = Number(image?.duration) || 0;
  const aspectRatio = width > 0 && height > 0 ? width / height : null;
  const bitrateBps =
    resourceType === "video" && duration > 0 && bytes > 0
      ? (bytes * 8) / duration
      : null;

  return {
    url,
    publicId,
    assetId: String(image?.assetId || image?.asset_id || image?._id || "").trim(),
    contentHash: String(
      image?.contentHash || image?.etag || identity?.contentHash || "",
    ).trim(),
    folder: String(image?.folder || "").trim(),
    resourceType,
    mimeType,
    width,
    height,
    format: String(image?.format || "").trim(),
    bytes,
    duration,
    aspectRatio,
    bitrateBps,
    bitrateKbps:
      bitrateBps !== null ? Number((bitrateBps / 1000).toFixed(2)) : null,
    visibility: normalizeGalleryVisibility(
      image?.visibility || identity?.visibility,
    ),
    createdAt:
      image?.createdAt || identity?.createdAt
        ? new Date(image?.createdAt || identity?.createdAt)
        : new Date(),
    updatedAt: image?.updatedAt || identity?.updatedAt || null,
  };
};

const buildMemoryLocalImageFile = (media) => ({
  identity: {
    fileName: String(media?.publicId || "").trim(),
    mimeType: String(media?.mimeType || "").trim(),
    url: String(media?.url || "").trim(),
    publicId: String(media?.publicId || "").trim(),
    assetId: String(media?.assetId || "").trim(),
    contentHash: String(media?.contentHash || "").trim(),
    folder: String(media?.folder || "").trim(),
    resourceType: String(media?.resourceType || "image").trim() || "image",
    width: Number(media?.width) || 0,
    height: Number(media?.height) || 0,
    format: String(media?.format || "").trim(),
    bytes: Number(media?.bytes) || 0,
    createdAt: media?.createdAt || new Date(),
    updatedAt: media?.updatedAt || null,
    shared: false,
  },
  ocr: {},
});

const buildMemoryLocalVideoFile = (media) => ({
  fileName: String(media?.fileName || media?.publicId || "").trim(),
  url: String(media?.url || "").trim(),
  publicId: String(media?.publicId || "").trim(),
  mimeType: String(media?.mimeType || "").trim(),
  assetId: String(media?.assetId || "").trim(),
  contentHash: String(media?.contentHash || "").trim(),
  folder: String(media?.folder || "").trim(),
  resourceType: String(media?.resourceType || "video").trim() || "video",
  width: Number(media?.width) || 0,
  height: Number(media?.height) || 0,
  format: String(media?.format || "").trim(),
  bytes: Number(media?.bytes) || 0,
  duration: Number(media?.duration) || 0,
  createdAt: media?.createdAt || new Date(),
  updatedAt: media?.updatedAt || null,
  shared: false,
});

const getHumanTraceMediaBucket = (
  trace,
  resourceType = "image",
  requiredModeOfIntervention = "",
) => {
  const userBucket =
    trace?.user && typeof trace.user === "object" ? trace.user : null;
  if (!userBucket) {
    return [];
  }

  const bucket =
    resourceType === "video"
      ? Array.isArray(userBucket.videos)
        ? userBucket.videos
        : []
      : Array.isArray(userBucket.images)
        ? userBucket.images
        : [];
  const normalizedRequiredMode = String(requiredModeOfIntervention || "").trim();
  const filteredBucket = normalizedRequiredMode
    ? bucket.filter(
        (item) =>
          String(item?.index?.MOI || "").trim() === normalizedRequiredMode ||
          String(item?.index?.MOI || "").trim() === "",
      )
    : bucket;

  return filteredBucket.map((item) => ({
    fileName: String(item?.index?.fileName || "").trim(),
    url: String(item?.storageContext?.url || "").trim(),
    publicId: String(item?.storageContext?.publicId || "").trim(),
    mimeType: String(item?.index?.mimeType || "").trim(),
    assetId: String(item?.storageContext?.assetId || "").trim(),
    contentHash: String(item?.index?.contentHash || "").trim(),
    folder: String(item?.storageContext?.folder || "").trim(),
    resourceType:
      String(item?.index?.resourceType || resourceType).trim() || resourceType,
    width: Number.isFinite(Number(item?.metadata?.width))
      ? Number(item.metadata.width)
      : null,
    height: Number.isFinite(Number(item?.metadata?.height))
      ? Number(item.metadata.height)
      : null,
    format: String(item?.metadata?.format || "").trim(),
    bytes: Number.isFinite(Number(item?.metadata?.bytes))
      ? Number(item.metadata.bytes)
      : null,
    duration: Number.isFinite(Number(item?.metadata?.duration))
      ? Number(item.metadata.duration)
      : null,
    totalPages: Number.isFinite(Number(item?.metadata?.totalPages))
      ? Number(item.metadata.totalPages)
      : null,
    visibility: normalizeGalleryVisibility(item?.metadata?.visibility),
    createdAt: item?.metadata?.createdAt || new Date(),
    updatedAt: item?.metadata?.updatedAt || new Date(),
  }));
};

const getMemoryLocalImages = (memoryDoc) =>
  Array.isArray(memoryDoc?.MOA)
    ? memoryDoc.MOA.flatMap((trace) =>
        getHumanTraceMediaBucket(trace, "image", "gallery"),
      )
    : memoryDoc?.MOA && typeof memoryDoc.MOA === "object"
      ? getHumanTraceMediaBucket(memoryDoc.MOA, "image", "gallery")
      : [];

const getMemoryLocalVideos = (memoryDoc) =>
  Array.isArray(memoryDoc?.MOA)
    ? memoryDoc.MOA.flatMap((trace) =>
        getHumanTraceMediaBucket(trace, "video", "gallery"),
      )
    : memoryDoc?.MOA && typeof memoryDoc.MOA === "object"
      ? getHumanTraceMediaBucket(memoryDoc.MOA, "video", "gallery")
      : [];

const sortGalleryImages = (images = []) =>
  images
    .filter(Boolean)
    .sort(
      (firstImage, secondImage) =>
        new Date(secondImage?.createdAt || 0).getTime() -
        new Date(firstImage?.createdAt || 0).getTime(),
    );

const getMemoryLocalGallery = (memoryDoc) =>
  sortGalleryImages([
    ...getMemoryLocalImages(memoryDoc).map(normalizeStoredGalleryImage).filter(Boolean),
    ...getMemoryLocalVideos(memoryDoc).map(normalizeStoredGalleryImage).filter(Boolean),
  ]);

export {
  buildMemoryLocalImageFile,
  buildMemoryLocalVideoFile,
  getMemoryLocalGallery,
  normalizeStoredGalleryImage,
  sortGalleryImages,
};
