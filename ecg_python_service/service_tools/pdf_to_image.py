import base64
import io

import pypdfium2 as pdfium


def render_pdf_page(payload):
    base64_data = str(payload.get("base64Data") or "").strip()
    page_number = max(1, int(payload.get("pdfPage") or 1))

    if not base64_data:
        raise ValueError("No PDF data was provided to the ECG PDF rasterizer.")

    pdf_bytes = base64.b64decode(base64_data, validate=False)
    pdf = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
    page_count = len(pdf)

    if page_count <= 0:
        raise ValueError("The uploaded PDF has no pages.")

    if page_number > page_count:
        raise ValueError(
            f"The uploaded PDF has only {page_count} page(s). Requested page {page_number}."
        )

    page = pdf.get_page(page_number - 1)
    bitmap = page.render(scale=2.5)
    pil_image = bitmap.to_pil()
    output = io.BytesIO()
    pil_image.save(output, format="PNG")
    page.close()
    pdf.close()

    return {
        "pageCount": page_count,
        "selectedPage": page_number,
        "mimeType": "image/png",
        "base64Data": base64.b64encode(output.getvalue()).decode("ascii"),
    }
