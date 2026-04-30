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

  return {
    url,
    publicId,
    assetId: String(image?.assetId || image?.asset_id || image?._id || "").trim(),
    folder: String(image?.folder || "").trim(),
    resourceType,
    mimeType,
    width: Number(image?.width) || 0,
    height: Number(image?.height) || 0,
    format: String(image?.format || "").trim(),
    bytes: Number(image?.bytes) || 0,
    duration: Number(image?.duration) || 0,
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

const getMemoryLocalImages = (memoryDoc) =>
  Array.isArray(memoryDoc?.files?.local?.images) ? memoryDoc.files.local.images : [];

const getMemoryLocalVideos = (memoryDoc) =>
  Array.isArray(memoryDoc?.files?.local?.videos) ? memoryDoc.files.local.videos : [];

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
