"""Image clean-up before the Tesseract retry (BE-07).

grayscale -> deskew -> denoise -> adaptive threshold -> upscale (if narrow).
Pure OpenCV/numpy, no model downloads, so it is cheap to test.
"""

from __future__ import annotations

import cv2
import numpy as np

MIN_WIDTH_PX = 2000
MAX_SKEW_DEG = 15.0  # beyond this the estimate is unreliable (rotated pages, big graphics): leave as is
MIN_SKEW_DEG = 0.1
MIN_TEXT_PIXELS = 200


def to_grayscale(image: np.ndarray) -> np.ndarray:
    if image.ndim == 2:
        return image
    if image.shape[2] == 4:
        return cv2.cvtColor(image, cv2.COLOR_BGRA2GRAY)
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def estimate_skew_deg(gray: np.ndarray) -> float:
    """Angle (degrees) to pass to `rotate` to make the text level; 0.0 if unsure.

    Uses the minimum-area rectangle around the dark (text) pixels.
    """
    _, text_mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    ys, xs = np.where(text_mask > 0)
    if len(xs) < MIN_TEXT_PIXELS:
        return 0.0
    points = np.column_stack((xs, ys)).astype(np.float32)
    angle = cv2.minAreaRect(points)[-1]
    # OpenCV reports the box angle modulo 90; fold it into (-45, 45]
    angle = ((angle + 45.0) % 90.0) - 45.0
    if abs(angle) < MIN_SKEW_DEG or abs(angle) > MAX_SKEW_DEG:
        return 0.0
    return float(angle)


def rotate(gray: np.ndarray, angle_deg: float) -> np.ndarray:
    height, width = gray.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle_deg, 1.0)
    return cv2.warpAffine(
        gray, matrix, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )


def deskew(gray: np.ndarray) -> np.ndarray:
    angle = estimate_skew_deg(gray)
    return rotate(gray, angle) if angle else gray


def preprocess_for_tesseract(image: np.ndarray) -> np.ndarray:
    """Return a clean, binarised, at-least-2000-px-wide grayscale image."""
    gray = deskew(to_grayscale(image))
    gray = cv2.fastNlMeansDenoising(gray, None, h=10, templateWindowSize=7, searchWindowSize=21)
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, blockSize=31, C=15
    )
    width = binary.shape[1]
    if width < MIN_WIDTH_PX:
        scale = MIN_WIDTH_PX / width
        binary = cv2.resize(binary, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        # cubic resampling leaves grey edge pixels; snap back to pure black/white
        _, binary = cv2.threshold(binary, 127, 255, cv2.THRESH_BINARY)
    return binary
