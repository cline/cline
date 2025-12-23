---
"claude-dev": patch
---

Description :

This PR fixes issue #7743 by improving how the file picker handles file visibility and how image files behave on non-vision models.

Changes :

    - Added gif support to IMAGE_EXTENSIONS and getMimeType.

    - Added * to the file filters so all file types (including code files) show up, especially on Windows.

    - Updated logic so:

        - Vision models can select and process images normally.

        - Non-vision models can still use *, but selected images are now detected and skipped with a clear warning instead of causing the API error (No endpoints found for image support).

        - Default filters still hide images for non-vision models to keep the picker clean.

Note

Switching from a vision model to a non-vision model does not remove previously attached images. This appears to be a separate UI state issue; mentioning it here for visibility.

Testing

- Verified .gif, wildcard visibility, and correct processing of images on vision models.

- Confirmed images on non-vision models are skipped safely with the new warning.
