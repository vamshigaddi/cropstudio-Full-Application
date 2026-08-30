"""Generation strategies — Background Removal (rembg)."""

import asyncio
from typing import Any

try:
    from rembg import remove
except ImportError:
    remove = None

from app.core.logging import get_logger
from app.integrations.ai.base import GenerationResult
from app.modules.generation.strategies.base import GenerationStrategy
from app.modules.jobs.models import Job

logger = get_logger(__name__)


class BackgroundRemovalStrategy(GenerationStrategy):
    """Strategy for removing image backgrounds locally using rembg."""

    def __init__(self) -> None:
        # We could initialize a specific rembg session here if needed
        pass

    def _run_rembg(self, input_bytes: bytes) -> bytes:
        """Run rembg synchronously with fallback if rembg fails or is missing."""
        if remove is not None:
            try:
                logger.debug("running_rembg_inference")
                return remove(input_bytes)
            except Exception as e:
                logger.warning("rembg_inference_failed_using_fallback", error=str(e))

        # Fallback background removal using PIL
        import io
        from PIL import Image as PilImage

        try:
            img = PilImage.open(io.BytesIO(input_bytes)).convert("RGBA")
            datas = img.getdata()
            new_data = []
            for item in datas:
                # If pixel is near pure white or near transparent light background
                if item[0] > 240 and item[1] > 240 and item[2] > 240:
                    new_data.append((255, 255, 255, 0))
                else:
                    new_data.append(item)
            img.putdata(new_data)
            output = io.BytesIO()
            img.save(output, format="PNG")
            return output.getvalue()
        except Exception as e:
            logger.error("pil_fallback_failed", error=str(e))
            return input_bytes

    def _composite_on_white(self, transparent_png_bytes: bytes) -> bytes:
        """Composite a transparent PNG onto a solid white background."""
        import io
        from PIL import Image as PilImage

        try:
            rgba_img = PilImage.open(io.BytesIO(transparent_png_bytes)).convert("RGBA")
            # Create a solid white background of the same size
            white_bg = PilImage.new("RGBA", rgba_img.size, (255, 255, 255, 255))
            # Paste rgba_img onto white_bg using alpha composite
            white_bg.alpha_composite(rgba_img)
            # Convert to RGB to discard alpha channel (solid white background)
            result_img = white_bg.convert("RGB")

            img_byte_arr = io.BytesIO()
            result_img.save(img_byte_arr, format="PNG")
            return img_byte_arr.getvalue()
        except Exception as e:
            logger.error("compositing_on_white_failed", error=str(e))
            return transparent_png_bytes

    async def execute(
        self,
        job: Job,
        input_image_bytes: bytes,
        config: dict[str, Any],
    ) -> GenerationResult:
        """Execute the background removal process."""
        logger.info("executing_background_removal_strategy", job_id=str(job.id))

        loop = asyncio.get_running_loop()

        # Run the CPU/GPU heavy rembg task in a background thread
        output_bytes = await loop.run_in_executor(None, self._run_rembg, input_image_bytes)

        # If white_background mode, composite it onto solid white
        if job.generation_mode == "white_background":
            output_bytes = await loop.run_in_executor(
                None, self._composite_on_white, output_bytes
            )

        return GenerationResult(
            image_bytes=output_bytes,
            mime_type="image/png",  # rembg typically outputs PNG with alpha
            metadata={"strategy": "rembg", "job_id": str(job.id)},
            provider_name="local_rembg",
        )
