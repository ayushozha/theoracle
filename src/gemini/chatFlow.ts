import type { GeminiPart } from './geminiClient';

const RENDERABLE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/avif',
]);

const IMAGE_EXT_RE = /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i;

export function isImageFile(file: File) {
  return file.type.startsWith('image/') || IMAGE_EXT_RE.test(file.name);
}

export function canPreviewImage(file: File) {
  if (RENDERABLE_IMAGE_TYPES.has(file.type)) return true;
  return /\.(avif|gif|jpe?g|png|webp)$/i.test(file.name);
}

export function buildVisionIntakePrompt(userText: string, files: { file: File }[]) {
  const text = userText.trim();
  const hasImage = files.some((attachment) => isImageFile(attachment.file));

  if (!hasImage) return text;

  const userIntent = text || 'The user uploaded a product photo and wants help selling it.';

  return `${userIntent}

Analyze the attached image first with Gemini vision before asking generic resale questions. If the item appears to be a MacBook or laptop, be cautious about what can be seen from the photo, then ask targeted follow-up questions before pricing or listing:
- exact model/year and screen size
- chip/build (M1, M1 Pro, M1 Max, M2, etc.), RAM, and storage
- battery cycle count and battery health
- scratches, dents, screen/keyboard issues, repairs, or liquid damage
- included charger, box, accessories, AppleCare, or warranty
- desired asking price, lowest acceptable price, and pickup/shipping preference

Do not jump straight to the Pricing Agent or listing draft until these intake details are answered, unless the user explicitly asks to price or list immediately. If speech text conflicts with the photo, trust the photo and clarify briefly.`;
}

export function buildUserParts(userText: string, files: { file: File }[]) {
  const parts: GeminiPart[] = [];
  const prompt = buildVisionIntakePrompt(userText, files);
  if (prompt.trim()) parts.push({ text: prompt });
  return parts;
}
