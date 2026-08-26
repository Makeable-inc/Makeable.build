export const OLED_WIDTH = 128;
export const OLED_HEIGHT = 128;
export const OLED_FRAME_BYTES = (OLED_WIDTH * OLED_HEIGHT) / 8;

function luminance(data, index) {
  return (data[index] * 0.2126) + (data[index + 1] * 0.7152) + (data[index + 2] * 0.0722);
}

function transformedCoordinates(x, y, rotate, mirrorX) {
  let tx = x;
  let ty = y;
  if (rotate === 90) {
    tx = OLED_WIDTH - 1 - y;
    ty = x;
  } else if (rotate === 180) {
    tx = OLED_WIDTH - 1 - x;
    ty = OLED_HEIGHT - 1 - y;
  } else if (rotate === 270) {
    tx = y;
    ty = OLED_HEIGHT - 1 - x;
  }
  if (mirrorX) tx = OLED_WIDTH - 1 - tx;
  return [tx, ty];
}

export function imageDataToFrame(imageData, options = {}) {
  if (imageData.width !== OLED_WIDTH || imageData.height !== OLED_HEIGHT) {
    throw new RangeError(`Expected ${OLED_WIDTH}x${OLED_HEIGHT} ImageData`);
  }

  const {
    threshold = 132,
    dither = true,
    invert = false,
    mirrorX = true,
    rotate = 0,
  } = options;
  const working = new Float32Array(OLED_WIDTH * OLED_HEIGHT);
  const data = imageData.data;
  for (let pixel = 0; pixel < working.length; pixel += 1) {
    working[pixel] = luminance(data, pixel * 4);
  }

  const frame = new Uint8Array(OLED_FRAME_BYTES);
  for (let y = 0; y < OLED_HEIGHT; y += 1) {
    for (let x = 0; x < OLED_WIDTH; x += 1) {
      const index = (y * OLED_WIDTH) + x;
      const oldValue = working[index];
      const white = oldValue >= threshold;
      const newValue = white ? 255 : 0;

      if (dither) {
        const error = oldValue - newValue;
        if (x + 1 < OLED_WIDTH) working[index + 1] += error * (7 / 16);
        if (y + 1 < OLED_HEIGHT) {
          if (x > 0) working[index + OLED_WIDTH - 1] += error * (3 / 16);
          working[index + OLED_WIDTH] += error * (5 / 16);
          if (x + 1 < OLED_WIDTH) working[index + OLED_WIDTH + 1] += error * (1 / 16);
        }
      }

      if (white !== invert) {
        const [tx, ty] = transformedCoordinates(x, y, rotate, mirrorX);
        frame[tx + (Math.floor(ty / 8) * OLED_WIDTH)] |= 1 << (ty & 7);
      }
    }
  }
  return frame;
}

export function frameToImageData(frame, context) {
  if (frame.length !== OLED_FRAME_BYTES) {
    throw new RangeError(`Expected ${OLED_FRAME_BYTES} frame bytes`);
  }
  const imageData = context.createImageData(OLED_WIDTH, OLED_HEIGHT);
  for (let y = 0; y < OLED_HEIGHT; y += 1) {
    for (let x = 0; x < OLED_WIDTH; x += 1) {
      const on = frame[x + (Math.floor(y / 8) * OLED_WIDTH)] & (1 << (y & 7));
      const value = on ? 255 : 0;
      const index = ((y * OLED_WIDTH) + x) * 4;
      imageData.data[index] = value;
      imageData.data[index + 1] = value;
      imageData.data[index + 2] = value;
      imageData.data[index + 3] = 255;
    }
  }
  return imageData;
}

export function drawMediaCover(context, source, fit = "cover") {
  const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
  const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
  if (!sourceWidth || !sourceHeight) return false;

  const scale = fit === "contain"
    ? Math.min(OLED_WIDTH / sourceWidth, OLED_HEIGHT / sourceHeight)
    : Math.max(OLED_WIDTH / sourceWidth, OLED_HEIGHT / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const x = (OLED_WIDTH - width) / 2;
  const y = (OLED_HEIGHT - height) / 2;

  context.save();
  context.fillStyle = "#000";
  context.fillRect(0, 0, OLED_WIDTH, OLED_HEIGHT);
  context.drawImage(source, x, y, width, height);
  context.restore();
  return true;
}

