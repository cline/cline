/**
 * English needs no table: the source text *is* the key, so a lookup miss already
 * renders the correct thing. This file exists so `en` is a real, selectable locale
 * in the registry instead of a special case sprinkled through the UI, and so a
 * future American-British spelling override or a term that the app wants to rename
 * has an obvious home.
 */
export default {} as const;
