/* global chrome, window, document, NodeFilter, InputEvent, HTMLTextAreaElement */
"use strict";

(() => {
  if (!Array.isArray(window.EMOJI_COMPLETER_DATA) || window.EMOJI_COMPLETER_DATA.length === 0) {
    return;
  }

  const DEFAULT_SETTINGS = {
    mode: "discord",
    triggerMinChars: 1,
    maxSuggestions: 8,
    commitWithTab: true,
    commitWithEnter: true,
    convertOnCloseColon: true,
    insertTrailingSpace: false,
    enableEmoticonConversion: false
  };

  const VALID_QUERY_RE = /^[a-z0-9_+\-]{0,40}$/i;
  const WORD_CHAR_RE = /[a-z0-9_]/i;
  const TOKEN_WITH_MULTIPLIER_RE = /(^|[^a-z0-9_])((\d{1,2})?:)([a-z0-9_+\-]{0,40})$/i;
  const MULTIPLIER_QUERY_GUARD_RE = /[a-z]/i;
  const MAX_MULTIPLIER = 20;
  const USAGE_KEY = "emojiCompleterUsage";

  const EMOTICON_PAIRS = [
    { code: ":)", emoji: "🙂" },
    { code: ":-)", emoji: "🙂" },
    { code: ":(", emoji: "🙁" },
    { code: ":-(", emoji: "🙁" },
    { code: ":D", emoji: "😄" },
    { code: ";)", emoji: "😉" },
    { code: ":P", emoji: "😛" },
    { code: "<3", emoji: "❤️" },
    { code: ":'(", emoji: "😢" }
  ];

  const indexed = buildEmojiIndex(window.EMOJI_COMPLETER_DATA);
  if (indexed.list.length === 0) {
    return;
  }

  let settings = { ...DEFAULT_SETTINGS };
  let usageCounts = Object.create(null);
  let usageSaveTimer = 0;

  let activeEditor = null;
  let isComposing = false;
  let refreshRaf = 0;
  let popup = null;
  let suggestions = [];
  let highlightedIndex = 0;
  let activeToken = null;

  const safeOnFocusIn = safeCallback(onFocusIn);
  const safeOnInput = safeCallback(onInput);
  const safeOnKeyDown = safeCallback(onKeyDown);
  const safeOnSelectionChange = safeCallback(onSelectionChange);
  const safeOnDocumentPointerDown = safeCallback(onDocumentPointerDown);
  const safeOnCompositionStart = safeCallback(onCompositionStart);
  const safeOnCompositionEnd = safeCallback(onCompositionEnd);
  const safeOnViewportChanged = safeCallback(onViewportChanged);
  const safeOnStorageChanged = safeCallback(onStorageChanged);

  init();

  function isExtensionContextValid() {
    try {
      return typeof chrome !== "undefined" && Boolean(chrome.runtime && chrome.runtime.id);
    } catch (error) {
      return false;
    }
  }

  function isContextInvalidationError(error) {
    return Boolean(error && String(error.message || error).includes("Extension context invalidated"));
  }

  function safeCallback(fn) {
    return (...args) => {
      if (!isExtensionContextValid()) {
        return;
      }
      try {
        return fn(...args);
      } catch (error) {
        if (isContextInvalidationError(error)) {
          hidePopup();
          return;
        }
        throw error;
      }
    };
  }

  function getStorageApi() {
    try {
      if (!isExtensionContextValid() || !chrome.storage) {
        return null;
      }
      return chrome.storage;
    } catch (error) {
      return null;
    }
  }

  function init() {
    popup = createPopup();
    loadSettings();
    loadUsageCounts();

    document.addEventListener("focusin", safeOnFocusIn, true);
    document.addEventListener("input", safeOnInput, true);
    document.addEventListener("keydown", safeOnKeyDown, true);
    document.addEventListener("selectionchange", safeOnSelectionChange, true);
    document.addEventListener("pointerdown", safeOnDocumentPointerDown, true);
    document.addEventListener("compositionstart", safeOnCompositionStart, true);
    document.addEventListener("compositionend", safeOnCompositionEnd, true);
    window.addEventListener("resize", safeOnViewportChanged);
    window.addEventListener("scroll", safeOnViewportChanged, true);

    const storage = getStorageApi();
    if (storage && storage.onChanged) {
      storage.onChanged.addListener(safeOnStorageChanged);
    }
  }

  function onStorageChanged(changes, areaName) {
    if (areaName === "sync") {
      const next = { ...settings };
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (Object.prototype.hasOwnProperty.call(changes, key)) {
          next[key] = changes[key].newValue;
        }
      }
      settings = { ...DEFAULT_SETTINGS, ...sanitizeSettings(next) };
      scheduleRefresh();
      return;
    }

    if (areaName === "local" && Object.prototype.hasOwnProperty.call(changes, USAGE_KEY)) {
      usageCounts = sanitizeUsageObject(changes[USAGE_KEY].newValue);
    }
  }

  function loadSettings() {
    const storage = getStorageApi();
    if (!storage || !storage.sync) {
      return;
    }

    storage.sync.get(DEFAULT_SETTINGS, safeCallback((stored) => {
      settings = { ...DEFAULT_SETTINGS, ...sanitizeSettings(stored || {}) };
      scheduleRefresh();
    }));
  }

  function loadUsageCounts() {
    const storage = getStorageApi();
    if (!storage || !storage.local) {
      return;
    }

    storage.local.get({ [USAGE_KEY]: {} }, safeCallback((result) => {
      usageCounts = sanitizeUsageObject(result[USAGE_KEY]);
    }));
  }

  function sanitizeSettings(candidate) {
    return {
      mode: candidate.mode === "slack" ? "slack" : "discord",
      triggerMinChars: coerceNumber(candidate.triggerMinChars, 0, 3, DEFAULT_SETTINGS.triggerMinChars),
      maxSuggestions: coerceNumber(candidate.maxSuggestions, 3, 20, DEFAULT_SETTINGS.maxSuggestions),
      commitWithTab: Boolean(candidate.commitWithTab),
      commitWithEnter: Boolean(candidate.commitWithEnter),
      convertOnCloseColon: Boolean(candidate.convertOnCloseColon),
      insertTrailingSpace: Boolean(candidate.insertTrailingSpace),
      enableEmoticonConversion: Boolean(candidate.enableEmoticonConversion)
    };
  }

  function sanitizeUsageObject(raw) {
    const clean = Object.create(null);
    if (!raw || typeof raw !== "object") {
      return clean;
    }

    for (const [key, value] of Object.entries(raw)) {
      if (!key || typeof key !== "string") {
        continue;
      }
      const normalized = key.trim().toLowerCase();
      if (!normalized) {
        continue;
      }
      const count = Number(value);
      if (!Number.isFinite(count) || count <= 0) {
        continue;
      }
      clean[normalized] = Math.floor(count);
    }
    return clean;
  }

  function coerceNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(numeric)));
  }

  function onFocusIn(event) {
    const editor = getEditorFromTarget(event.target);
    if (!editor || !isSupportedEditor(editor)) {
      if (popup && !popup.contains(event.target)) {
        hidePopup();
      }
      return;
    }

    activeEditor = editor;
    scheduleRefresh();
  }

  function onInput(event) {
    const editor = getEditorFromTarget(event.target);
    if (!editor || !isSupportedEditor(editor)) {
      return;
    }

    activeEditor = editor;
    if (isComposing) {
      return;
    }

    if (settings.convertOnCloseColon && maybeAutoConvertExactShortcode(editor)) {
      return;
    }

    if (settings.enableEmoticonConversion) {
      maybeAutoConvertEmoticon(editor);
    }

    scheduleRefresh();
  }

  function onCompositionStart(event) {
    const editor = getEditorFromTarget(event.target);
    if (editor && isSupportedEditor(editor)) {
      activeEditor = editor;
      isComposing = true;
      hidePopup();
    }
  }

  function onCompositionEnd(event) {
    const editor = getEditorFromTarget(event.target);
    if (editor && isSupportedEditor(editor)) {
      activeEditor = editor;
    }
    isComposing = false;
    scheduleRefresh();
  }

  function onSelectionChange() {
    if (!activeEditor || !isPopupVisible()) {
      return;
    }
    scheduleRefresh();
  }

  function onDocumentPointerDown(event) {
    if (!isPopupVisible()) {
      return;
    }
    if (!popup.contains(event.target)) {
      hidePopup();
    }
  }

  function onViewportChanged() {
    if (!isPopupVisible()) {
      return;
    }
    scheduleRefresh();
  }

  function onKeyDown(event) {
    if (!isPopupVisible() || !activeEditor) {
      return;
    }

    const editor = getEditorFromTarget(event.target);
    if (!editor || editor !== activeEditor) {
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      moveSelection(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      moveSelection(-1);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      hidePopup();
      return;
    }

    const commitsWithTab = event.key === "Tab" && settings.commitWithTab;
    const commitsWithEnter = event.key === "Enter" && settings.commitWithEnter && !event.shiftKey;
    if (!commitsWithTab && !commitsWithEnter) {
      return;
    }

    if (suggestions.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    commitSuggestion(highlightedIndex);
  }

  function scheduleRefresh() {
    if (refreshRaf) {
      cancelAnimationFrame(refreshRaf);
    }
    refreshRaf = requestAnimationFrame(() => {
      refreshRaf = 0;
      safeCallback(refreshPopupState)();
    });
  }

  function refreshPopupState() {
    if (isComposing || !activeEditor || !isSupportedEditor(activeEditor) || !isEditorFocused(activeEditor)) {
      hidePopup();
      return;
    }

    const snapshot = getEditorSnapshot(activeEditor);
    if (!snapshot || !snapshot.isCollapsed) {
      hidePopup();
      return;
    }

    const token = extractActiveToken(snapshot.textBefore);
    if (!token) {
      hidePopup();
      return;
    }

    if (token.query.length < settings.triggerMinChars) {
      hidePopup();
      return;
    }

    const nextSuggestions = searchEmoji(token.query, settings.maxSuggestions);
    if (nextSuggestions.length === 0) {
      hidePopup();
      return;
    }

    const previousCode = suggestions[highlightedIndex] ? suggestions[highlightedIndex].entry.shortcode : "";
    suggestions = nextSuggestions;
    activeToken = token;
    highlightedIndex = indexOfShortcode(suggestions, previousCode);
    if (highlightedIndex < 0) {
      highlightedIndex = 0;
    }

    renderPopup();
    positionPopup(snapshot.caretRect);
  }

  function indexOfShortcode(items, shortcode) {
    if (!shortcode) {
      return -1;
    }
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].entry.shortcode === shortcode) {
        return i;
      }
    }
    return -1;
  }

  function createPopup() {
    const node = document.createElement("div");
    node.id = "emoji-completer-popup";
    node.hidden = true;
    node.setAttribute("role", "listbox");
    node.setAttribute("aria-label", "Emoji suggestions");
    node.addEventListener("pointerdown", onPopupPointerDown);
    node.addEventListener("mousemove", onPopupMouseMove);
    document.documentElement.appendChild(node);
    return node;
  }

  function onPopupPointerDown(event) {
    const option = event.target.closest(".emoji-completer-option");
    if (!option) {
      return;
    }
    const index = Number(option.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= suggestions.length) {
      return;
    }
    event.preventDefault();
    highlightedIndex = index;
    commitSuggestion(index);
  }

  function onPopupMouseMove(event) {
    const option = event.target.closest(".emoji-completer-option");
    if (!option) {
      return;
    }
    const index = Number(option.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= suggestions.length || index === highlightedIndex) {
      return;
    }
    highlightedIndex = index;
    syncSelectedOption();
  }

  function renderPopup() {
    if (!popup) {
      return;
    }

    popup.innerHTML = "";
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < suggestions.length; i += 1) {
      const suggestion = suggestions[i];
      const row = document.createElement("div");
      row.className = "emoji-completer-option";
      row.dataset.index = String(i);
      row.dataset.selected = i === highlightedIndex ? "true" : "false";
      row.setAttribute("role", "option");
      row.id = `emoji-completer-option-${i}`;
      row.setAttribute("aria-selected", i === highlightedIndex ? "true" : "false");

      const emoji = document.createElement("span");
      emoji.className = "emoji-completer-char";
      emoji.textContent = suggestion.entry.emoji;

      const code = document.createElement("span");
      code.className = "emoji-completer-code";
      code.textContent = `:${suggestion.entry.shortcode}:`;

      const alias = document.createElement("span");
      alias.className = "emoji-completer-alias";
      alias.textContent = suggestion.matchAlias ? suggestion.matchAlias : "";

      row.appendChild(emoji);
      row.appendChild(code);
      row.appendChild(alias);
      fragment.appendChild(row);
    }

    popup.appendChild(fragment);
    popup.hidden = false;
    popup.setAttribute("aria-activedescendant", `emoji-completer-option-${highlightedIndex}`);
  }

  function syncSelectedOption() {
    if (!popup || popup.hidden) {
      return;
    }

    const options = popup.querySelectorAll(".emoji-completer-option");
    for (let i = 0; i < options.length; i += 1) {
      const isSelected = i === highlightedIndex;
      options[i].dataset.selected = isSelected ? "true" : "false";
      options[i].setAttribute("aria-selected", isSelected ? "true" : "false");
      if (isSelected) {
        options[i].scrollIntoView({ block: "nearest" });
      }
    }
    popup.setAttribute("aria-activedescendant", `emoji-completer-option-${highlightedIndex}`);
  }

  function positionPopup(caretRect) {
    if (!popup || popup.hidden || !caretRect) {
      hidePopup();
      return;
    }

    popup.style.left = "0px";
    popup.style.top = "0px";
    const margin = 8;
    const verticalGap = 6;
    const popupRect = popup.getBoundingClientRect();

    let left = caretRect.left;
    let top = caretRect.bottom + verticalGap;
    if (left + popupRect.width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - popupRect.width - margin);
    }
    if (left < margin) {
      left = margin;
    }

    if (top + popupRect.height + margin > window.innerHeight) {
      top = caretRect.top - popupRect.height - verticalGap;
    }
    if (top < margin) {
      top = margin;
    }

    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
  }

  function isPopupVisible() {
    return Boolean(popup && !popup.hidden);
  }

  function hidePopup() {
    suggestions = [];
    highlightedIndex = 0;
    activeToken = null;
    if (popup) {
      popup.hidden = true;
      popup.removeAttribute("aria-activedescendant");
      popup.innerHTML = "";
    }
  }

  function moveSelection(direction) {
    if (!suggestions.length) {
      return;
    }
    highlightedIndex = (highlightedIndex + direction + suggestions.length) % suggestions.length;
    syncSelectedOption();
  }

  function commitSuggestion(index) {
    if (!activeEditor || index < 0 || index >= suggestions.length) {
      return;
    }

    const snapshot = getEditorSnapshot(activeEditor);
    const liveToken = snapshot && snapshot.isCollapsed ? extractActiveToken(snapshot.textBefore) : null;
    if (!liveToken) {
      hidePopup();
      return;
    }

    const suggestion = suggestions[index];
    const replacement = buildEmojiReplacement(suggestion.entry.emoji, liveToken.multiplier);
    const replaced = replaceTextInEditor(activeEditor, liveToken.start, liveToken.end, replacement);
    if (!replaced) {
      return;
    }

    recordUsage(suggestion.entry.shortcode);
    hidePopup();
  }

  function maybeAutoConvertExactShortcode(editor) {
    const snapshot = getEditorSnapshot(editor);
    if (!snapshot || !snapshot.isCollapsed || !snapshot.textBefore || !snapshot.textBefore.endsWith(":")) {
      return false;
    }

    const withoutClosingColon = snapshot.textBefore.slice(0, -1);
    const token = extractActiveToken(withoutClosingColon);
    if (!token || !token.query) {
      return false;
    }

    const match = lookupEmojiByCode(token.query);
    if (!match) {
      return false;
    }

    const replacement = buildEmojiReplacement(match.emoji, token.multiplier);
    const replaced = replaceTextInEditor(editor, token.start, snapshot.textBefore.length, replacement);
    if (!replaced) {
      return false;
    }

    recordUsage(match.shortcode);
    hidePopup();
    return true;
  }

  function maybeAutoConvertEmoticon(editor) {
    const snapshot = getEditorSnapshot(editor);
    if (!snapshot || !snapshot.isCollapsed || !snapshot.textBefore) {
      return false;
    }

    for (const pair of EMOTICON_PAIRS) {
      if (!snapshot.textBefore.endsWith(pair.code)) {
        continue;
      }

      const start = snapshot.textBefore.length - pair.code.length;
      const prev = start > 0 ? snapshot.textBefore[start - 1] : " ";
      if (WORD_CHAR_RE.test(prev)) {
        continue;
      }

      const replacement = pair.emoji + (settings.insertTrailingSpace ? " " : "");
      const replaced = replaceTextInEditor(editor, start, snapshot.textBefore.length, replacement);
      if (replaced) {
        hidePopup();
        return true;
      }
    }

    return false;
  }

  function buildEmojiReplacement(emoji, multiplier) {
    const count = clampMultiplier(multiplier);
    const base = count > 1 ? emoji.repeat(count) : emoji;
    return base + (settings.insertTrailingSpace ? " " : "");
  }

  function replaceTextInEditor(editor, start, end, replacement) {
    if (start < 0 || end < start) {
      return false;
    }

    if (editor instanceof HTMLTextAreaElement) {
      return replaceInTextarea(editor, start, end, replacement);
    }

    return replaceInContentEditable(editor, start, end, replacement);
  }

  function replaceInTextarea(editor, start, end, replacement) {
    if (typeof editor.value !== "string") {
      return false;
    }

    const valueLength = editor.value.length;
    const safeStart = Math.max(0, Math.min(start, valueLength));
    const safeEnd = Math.max(safeStart, Math.min(end, valueLength));

    editor.focus();
    editor.setRangeText(replacement, safeStart, safeEnd, "end");
    dispatchInputEvent(editor, replacement);
    return true;
  }

  function replaceInContentEditable(editor, start, end, replacement) {
    const characterCount = Math.max(0, end - start);
    const range = createRangeFromCaret(editor, characterCount) || createRangeFromTextOffsets(editor, start, end);
    if (!range) {
      return false;
    }

    editor.focus();
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }

    if (selection && tryExecInsertText(replacement)) {
      return true;
    }

    range.deleteContents();
    const textNode = document.createTextNode(replacement);
    range.insertNode(textNode);

    if (selection) {
      const caret = document.createRange();
      caret.setStart(textNode, textNode.nodeValue.length);
      caret.collapse(true);
      selection.removeAllRanges();
      selection.addRange(caret);
    }

    dispatchInputEvent(editor, replacement);
    return true;
  }

  function createRangeFromCaret(editor, characterCount) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const caret = selection.getRangeAt(0).cloneRange();
    if (!caret.collapsed || !editor.contains(caret.startContainer) || !editor.contains(caret.endContainer)) {
      return null;
    }

    const range = document.createRange();
    range.setEnd(caret.endContainer, caret.endOffset);

    if (characterCount === 0) {
      range.setStart(caret.startContainer, caret.startOffset);
      return range;
    }

    if (typeof selection.modify !== "function") {
      return null;
    }

    selection.removeAllRanges();
    selection.addRange(caret);

    for (let i = 0; i < characterCount; i += 1) {
      const beforeNode = selection.anchorNode;
      const beforeOffset = selection.anchorOffset;
      selection.modify("move", "backward", "character");
      if (selection.anchorNode === beforeNode && selection.anchorOffset === beforeOffset) {
        break;
      }
    }

    if (selection.rangeCount === 0) {
      selection.removeAllRanges();
      selection.addRange(caret);
      return null;
    }

    const startRange = selection.getRangeAt(0).cloneRange();
    selection.removeAllRanges();
    selection.addRange(caret);

    if (!editor.contains(startRange.startContainer) && startRange.startContainer !== editor) {
      return null;
    }

    range.setStart(startRange.startContainer, startRange.startOffset);
    return range;
  }

  function tryExecInsertText(text) {
    if (typeof document.execCommand !== "function") {
      return false;
    }
    try {
      return document.execCommand("insertText", false, text);
    } catch (error) {
      return false;
    }
  }

  function createRangeFromTextOffsets(root, startOffset, endOffset) {
    const start = locateTextPoint(root, startOffset);
    const end = locateTextPoint(root, endOffset);
    if (!start || !end) {
      return null;
    }

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  }

  function locateTextPoint(root, targetOffset) {
    let remaining = Math.max(0, targetOffset);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let lastTextNode = null;

    while (node) {
      lastTextNode = node;
      const size = node.nodeValue.length;
      if (remaining <= size) {
        return { node, offset: remaining };
      }
      remaining -= size;
      node = walker.nextNode();
    }

    if (lastTextNode) {
      return { node: lastTextNode, offset: lastTextNode.nodeValue.length };
    }

    const childCount = root.childNodes ? root.childNodes.length : 0;
    return { node: root, offset: Math.min(remaining, childCount) };
  }

  function dispatchInputEvent(target, insertedText) {
    let event;
    try {
      event = new InputEvent("input", {
        bubbles: true,
        cancelable: false,
        inputType: "insertText",
        data: insertedText
      });
    } catch (error) {
      event = new Event("input", { bubbles: true, cancelable: false });
    }
    target.dispatchEvent(event);
  }

  function getEditorSnapshot(editor) {
    if (editor instanceof HTMLTextAreaElement) {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      if (typeof start !== "number" || typeof end !== "number") {
        return null;
      }
      const isCollapsed = start === end;
      return {
        kind: "textarea",
        isCollapsed,
        textBefore: editor.value.slice(0, start),
        caretRect: isCollapsed ? getTextareaCaretRect(editor, start) : null
      };
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
      return null;
    }

    const isCollapsed = range.collapsed;
    const before = range.cloneRange();
    before.selectNodeContents(editor);
    before.setEnd(range.endContainer, range.endOffset);

    return {
      kind: "contenteditable",
      isCollapsed,
      textBefore: normalizeNewlines(before.toString()),
      caretRect: isCollapsed ? getRangeCaretRect(range) : null
    };
  }

  function normalizeNewlines(value) {
    return value.replace(/\r\n/g, "\n");
  }

  function getRangeCaretRect(range) {
    const clone = range.cloneRange();
    clone.collapse(true);

    const rects = clone.getClientRects();
    if (rects && rects.length > 0) {
      return rects[rects.length - 1];
    }

    const rect = clone.getBoundingClientRect();
    if (rect && (rect.width !== 0 || rect.height !== 0)) {
      return rect;
    }
    return null;
  }

  function getTextareaCaretRect(textarea, caretIndex) {
    const style = window.getComputedStyle(textarea);
    const mirror = document.createElement("div");
    mirror.style.position = "fixed";
    mirror.style.left = "-9999px";
    mirror.style.top = "0";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.style.visibility = "hidden";
    mirror.style.fontFamily = style.fontFamily;
    mirror.style.fontSize = style.fontSize;
    mirror.style.fontWeight = style.fontWeight;
    mirror.style.letterSpacing = style.letterSpacing;
    mirror.style.lineHeight = style.lineHeight;
    mirror.style.paddingTop = style.paddingTop;
    mirror.style.paddingRight = style.paddingRight;
    mirror.style.paddingBottom = style.paddingBottom;
    mirror.style.paddingLeft = style.paddingLeft;
    mirror.style.borderTopWidth = style.borderTopWidth;
    mirror.style.borderRightWidth = style.borderRightWidth;
    mirror.style.borderBottomWidth = style.borderBottomWidth;
    mirror.style.borderLeftWidth = style.borderLeftWidth;
    mirror.style.boxSizing = style.boxSizing;
    mirror.style.width = `${textarea.clientWidth}px`;
    mirror.style.overflow = "hidden";

    const textBefore = textarea.value.slice(0, caretIndex);
    mirror.textContent = textBefore;

    const marker = document.createElement("span");
    marker.textContent = textarea.value.slice(caretIndex, caretIndex + 1) || " ";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);

    const markerRect = marker.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();
    const areaRect = textarea.getBoundingClientRect();
    const left = areaRect.left + (markerRect.left - mirrorRect.left) - textarea.scrollLeft;
    const top = areaRect.top + (markerRect.top - mirrorRect.top) - textarea.scrollTop;
    const height = markerRect.height || parseFloat(style.lineHeight) || 16;

    document.body.removeChild(mirror);
    return {
      left,
      top,
      bottom: top + height
    };
  }

  function extractActiveToken(textBeforeCaret) {
    if (typeof textBeforeCaret !== "string" || textBeforeCaret.length === 0) {
      return null;
    }

    const match = TOKEN_WITH_MULTIPLIER_RE.exec(textBeforeCaret);
    if (!match) {
      return null;
    }

    const boundary = match[1] || "";
    const multiplierRaw = match[3] || "";
    const queryRaw = match[4] || "";

    if (!VALID_QUERY_RE.test(queryRaw)) {
      return null;
    }

    if (multiplierRaw && queryRaw && !MULTIPLIER_QUERY_GUARD_RE.test(queryRaw)) {
      return null;
    }

    const multiplier = clampMultiplier(multiplierRaw);
    const start = match.index + boundary.length;

    return {
      start,
      end: textBeforeCaret.length,
      query: queryRaw.toLowerCase(),
      multiplier
    };
  }

  function clampMultiplier(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 1;
    }
    return Math.min(MAX_MULTIPLIER, Math.max(1, Math.floor(parsed)));
  }

  function lookupEmojiByCode(rawCode) {
    const code = String(rawCode || "").trim().toLowerCase();
    if (!code) {
      return null;
    }
    const byShortcode = indexed.shortcodeMap.get(code);
    if (byShortcode) {
      return byShortcode;
    }
    const byAlias = indexed.aliasMap.get(code);
    if (byAlias) {
      return byAlias;
    }
    return null;
  }

  function searchEmoji(query, maxItems) {
    const q = String(query || "").trim().toLowerCase();
    const limit = Math.max(1, maxItems);

    if (!q) {
      const fallback = indexed.list
        .slice()
        .sort((a, b) => getUsageScore(b.shortcode) - getUsageScore(a.shortcode) || a.shortcode.localeCompare(b.shortcode))
        .slice(0, limit)
        .map((entry) => ({ entry, score: 1, matchAlias: "" }));
      return fallback;
    }

    const matches = [];
    for (const entry of indexed.list) {
      let score = 0;
      let matchAlias = "";

      if (entry.shortcode === q) {
        score = 1200;
      } else if (entry.aliasesSet.has(q)) {
        score = 1140;
        matchAlias = q;
      } else if (entry.shortcode.startsWith(q)) {
        score = 1080;
      } else {
        for (const alias of entry.aliases) {
          if (alias.startsWith(q)) {
            score = Math.max(score, 1030);
            if (!matchAlias) {
              matchAlias = alias;
            }
          } else if (alias.includes(q)) {
            score = Math.max(score, 880);
            if (!matchAlias) {
              matchAlias = alias;
            }
          }
        }
      }

      if (score === 0 && entry.shortcode.includes(q)) {
        score = 900;
      }

      if (score === 0) {
        for (const keyword of entry.keywords) {
          if (keyword.startsWith(q)) {
            score = 780;
            break;
          }
          if (keyword.includes(q)) {
            score = 700;
          }
        }
      }

      if (score === 0) {
        continue;
      }

      score += Math.min(50, getUsageScore(entry.shortcode)) * 4;
      matches.push({ entry, score, matchAlias });
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const usageDelta = getUsageScore(b.entry.shortcode) - getUsageScore(a.entry.shortcode);
      if (usageDelta !== 0) {
        return usageDelta;
      }
      return a.entry.shortcode.localeCompare(b.entry.shortcode);
    });

    return matches.slice(0, limit);
  }

  function getUsageScore(shortcode) {
    return Number(usageCounts[shortcode]) || 0;
  }

  function recordUsage(shortcode) {
    if (!shortcode) {
      return;
    }
    const key = shortcode.toLowerCase();
    usageCounts[key] = (usageCounts[key] || 0) + 1;
    scheduleUsagePersist();
  }

  function scheduleUsagePersist() {
    const storage = getStorageApi();
    if (!storage || !storage.local) {
      return;
    }
    if (usageSaveTimer) {
      clearTimeout(usageSaveTimer);
    }
    usageSaveTimer = window.setTimeout(() => {
      usageSaveTimer = 0;
      const latestStorage = getStorageApi();
      if (!latestStorage || !latestStorage.local) {
        return;
      }
      latestStorage.local.set({ [USAGE_KEY]: usageCounts });
    }, 300);
  }

  function buildEmojiIndex(rawEntries) {
    const list = [];
    const shortcodeMap = new Map();
    const aliasMap = new Map();
    const seen = new Set();

    for (const raw of rawEntries) {
      if (!raw || typeof raw !== "object") {
        continue;
      }

      const emoji = typeof raw.emoji === "string" ? raw.emoji : "";
      const shortcode = typeof raw.shortcode === "string" ? raw.shortcode.trim().toLowerCase() : "";
      if (!emoji || !shortcode || seen.has(shortcode)) {
        continue;
      }
      seen.add(shortcode);

      const aliases = Array.isArray(raw.aliases)
        ? raw.aliases
            .map((alias) => String(alias).trim().toLowerCase())
            .filter((alias) => alias && alias !== shortcode)
        : [];
      const uniqueAliases = Array.from(new Set(aliases));
      const keywords = Array.isArray(raw.keywords)
        ? raw.keywords.map((keyword) => String(keyword).trim().toLowerCase()).filter(Boolean)
        : [];

      const entry = {
        emoji,
        shortcode,
        aliases: uniqueAliases,
        aliasesSet: new Set(uniqueAliases),
        keywords
      };
      list.push(entry);
      shortcodeMap.set(shortcode, entry);
      for (const alias of uniqueAliases) {
        if (!aliasMap.has(alias)) {
          aliasMap.set(alias, entry);
        }
      }
    }

    return { list, shortcodeMap, aliasMap };
  }

  function getEditorFromTarget(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    if (popup && popup.contains(target)) {
      return null;
    }

    if (target instanceof HTMLTextAreaElement) {
      return target;
    }

    const candidate = target.closest("textarea, [contenteditable='true'], [contenteditable='plaintext-only'], [role='textbox'][contenteditable]");
    if (!candidate) {
      return null;
    }

    if (candidate instanceof HTMLTextAreaElement) {
      return candidate;
    }
    if (candidate instanceof HTMLElement && candidate.isContentEditable) {
      return candidate;
    }
    return null;
  }

  function isSupportedEditor(editor) {
    if (!editor) {
      return false;
    }
    if (editor instanceof HTMLTextAreaElement) {
      return !editor.readOnly && !editor.disabled;
    }
    return editor instanceof HTMLElement && editor.isContentEditable;
  }

  function isEditorFocused(editor) {
    if (editor instanceof HTMLTextAreaElement) {
      return document.activeElement === editor;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return false;
    }
    const range = selection.getRangeAt(0);
    return editor.contains(range.startContainer) && editor.contains(range.endContainer);
  }
})();
