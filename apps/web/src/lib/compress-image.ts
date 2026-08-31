/** Browser-side image compression before property media upload. */

const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.68;
const TARGET_BYTES = 800_000;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image_decode_failed'));
    };
    image.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('image_encode_failed'))),
      type,
      quality,
    );
  });
}

/** Shrink and re-encode large photos (JPEG/WebP) for faster upload and less storage. */
export async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file;
  if (file.size <= 450_000) return file;

  try {
    const image = await loadImage(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(image, 0, 0, width, height);

    let quality = JPEG_QUALITY;
    let blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    while (blob.size > TARGET_BYTES && quality > 0.45) {
      quality -= 0.08;
      blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    }

    if (blob.size >= file.size * 0.95) return file;
    const base = file.name.replace(/\.[^.]+$/, '') || 'property';
    return new File([blob], `${base}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}
