// Sogoni - an out-of-story side panel for talking ABOUT the current chat.
// Nothing here is written into the chat log or the roleplay prompt.

const MODULE = 'sogoni';
const SELECTION_TTL_MS = 5 * 60 * 1000;
const QUOTE_MAX_CHARS = 4000;

const defaultSettings = Object.freeze({
    profileId: '',
    fastProfileId: '',       // optional second profile for quick back-and-forth modes
    fastModes: ['fan'],      // mode keys that use the fast profile
    maxTokens: 8192,         // thinking models spend part of this on reasoning before they write
    rangeMode: 'same',       // 'same' (what the character sees) | 'count' | 'tokens' | 'all' (hidden ones too) | 'card' (card + persona only)
    rangeCount: 50,
    rangeTokens: 8000,
    historyTurns: 12,        // how many side-chat messages are sent back as history
    includeLore: true,
    includeInjections: true,
    rxCriteria: '',          // the user's own checklist for the prescription mode
    customModes: [],         // [{ id, label, prompt, ask }] written by the user
    hiddenModes: [],         // keys of chips the user turned off
    showStats: true,
    replySound: true,        // play a soft chime when Sogoni's reply arrives
    replySoundWhen: 'away',  // 'away' (panel closed, or another tab/app in front) | 'always'         // briefly show what was read after each request
    useCache: true,          // mark the story context as cacheable (Sogoni requests only)
    persona: 'friend',
    customPersona: '',
    replyLang: 'Korean',
    lastMode: 'free',        // chip that was selected last, restored on load
    replyLength: 'auto',     // 'auto' (each mode decides) | 'short' | 'long'
    showFab: false,          // default: open from the wand menu only
    showInputIcon: false,
    fabSide: 'right',        // 'left' | 'right': default side of the floating button
    panelWidth: 420,
    fabPos: null,            // { left, top } in px
    layoutVersion: 0,
});

// ---------------------------------------------------------------------------
// Prompts (model-facing text is English)
// ---------------------------------------------------------------------------

const BASE_PROMPT = `Your name is Sogoni, a little ghost who whispers beside the user. The story's characters cannot see or hear you. Do not bring this up unless it comes up naturally.
You are a companion sitting next to the user while they play an ongoing roleplay story: a chat between the user's persona and one or more AI-played characters.
You are NOT a participant in that story. Never continue the roleplay, never write the next story turn, and never answer as one of the characters. You talk WITH the user ABOUT the story, out of character.

Below you receive exactly what the character AI currently holds in memory: the character sheet, the user's persona, active lore, injected memory (summaries of older events and other notes), and the currently visible chat messages, numbered like #123.
Older parts of the story exist only as summaries. Treat summaries as true canon.

The user is the author and reader of this story, not the persona they write. Treat the user's persona as one more fictional character: refer to the persona by name in the third person, exactly as you do with the AI-played characters. Never address the user as if they were the persona, and never attribute the persona's feelings, choices or relationships to the user personally.

Rules:
- Ground every claim in the provided material. When you infer instead of read, make that clear.
- If the material does not contain the answer, say you cannot tell. Do not invent events.
- Point to specific moments with their message numbers (#123) when it helps.
- This is fiction. Discuss its content plainly as fiction.
- Keep answers sized for a side chat unless the user asks for depth.`;

const PERSONAS = {
    friend: {
        label: '덕후 친구 (반말)',
        prompt: 'Voice: a close friend who is really into this story. Casual, warm, a little playful, with opinions of your own. When replying in Korean, use informal speech (banmal).',
    },
    analyst: {
        label: '차분한 분석가 (존댓말)',
        prompt: 'Voice: a calm, observant analyst. Polite, clear and organized, never gushing. When replying in Korean, use polite speech (jondaetmal).',
    },
    editor: {
        label: '무뚝뚝한 편집자',
        prompt: 'Voice: a dry, blunt veteran editor. Short sentences, no filler, says what works and what does not without softening it.',
    },
    custom: { label: '직접 입력', prompt: '' },
};

const MODES = {
    free: {
        icon: '💬', label: '자유',
        placeholder: '뭐든 물어봐',
        defaultShown: '',
        defaultAsk: '',
        prompt: 'Answer the user\'s question about the story directly.',
    },
    recap: {
        icon: '🧭', label: '상황 정리',
        placeholder: '비우고 보내면 지금 상황을 정리해줘',
        defaultShown: '지금 뭔 상황이야? 왜 이렇게 된 거야?',
        defaultAsk: 'I lost track. What is the situation right now, and how did it get here?',
        prompt: `The user skimmed part of the story and lost track. Explain the present situation.
- Start with one or two sentences on where things stand right now.
- Then give the causal chain that led here: what happened, why, and what it caused. Use message numbers.
- Prioritize what a skimming reader most likely missed: recent turning points, shifts in a character's attitude, newly revealed information.
- Do not retell everything. Cover only what is needed to understand the current scene.
- If the user asks about one specific thing, answer that first.`,
    },
    mind: {
        icon: '💭', label: '속마음',
        placeholder: '누구의 어떤 행동이 궁금해?',
        defaultShown: '얘 지금 왜 이러는 거야? 속마음이 뭐야?',
        defaultAsk: 'Why is the character acting like this in the latest messages? What is going on inside their head?',
        prompt: `Interpret what is going on inside a character's head. If the user does not name a character or a moment, use the main AI-played character and their most recent behavior.
- Use the character sheet (personality, background, hidden motives), the established history, and the recent messages.
- Explain motive, emotion, what they want, and what they are hiding or avoiding.
- Separate what the text explicitly shows from your reasoned inference.
- Do not just paraphrase their actions.
- You may end with a short first-person inner monologue in the character's voice, clearly marked as your interpretation.`,
    },
    fan: {
        icon: '🍿', label: '덕톡',
        placeholder: '같이 떠들자',
        defaultShown: '얘네 요즘 어떤 거 같아? 같이 떠들자ㅋㅋ',
        defaultAsk: 'Let\'s just fan-chat about how these characters and their relationship are going lately.',
        prompt: `This is fan chat. You are a fellow reader who is just as hooked on this story as the user, squealing about it together. You are NOT an analyst here.
- React first, with feeling: excitement, disbelief, teasing, laughing, jumping to conclusions about where this is heading. Show that you are invested.
- Do not explain the story back to the user. They read it too. No recap, no organized argument, no list of evidence, no character-psychology essay.
- Grab the one or two moments that got you the most and gush about those, instead of surveying everything. Mention a detail the way a fan would ("that part with the feather, I lost it"). In this mode message numbers are optional; use one only when it helps point at a moment.
- Have your own takes and wild guesses, and playfully disagree when you do. Answer the user's question with your gut preference, not with a balanced comparison.
- Sound like texting a friend: short bursts, casual interjections and laughter natural to the reply language. No headers, no bullet lists.
- Length follows the moment, with no fixed size: a quick reaction gets a quick reply, and when you are bursting with things to say you may ramble excitedly. But rambling means more reactions, not more analysis.
- Match the user's energy.
- Do not end with a question or a prompt for the user to respond. No "what do you think?", no forced follow-up. Just say your piece and stop where it naturally ends. Ask something only on the rare occasion you are honestly curious about the user's take.`,
    },
    ideas: {
        icon: '💡', label: '전개',
        placeholder: '원하는 분위기나 방향이 있으면 적어줘',
        defaultShown: '앞으로 이야기 큰 흐름을 어떻게 가져가면 좋을까?',
        defaultAsk: 'Where could this story head in the long run? Suggest some big-picture directions.',
        prompt: `Suggest big-picture directions for where this story could head over the coming arc. Think like a story planner sketching the overall shape, not like someone writing the next line.
- Offer 3 to 4 clearly different overall directions. Make them differ in what kind of story it becomes (for example: the relationship deepening slowly, an outside conflict or threat taking over, a hidden truth coming out and changing everything, a fracture between the characters and its repair), not just in small events.
- For each direction:
  - a short name and a one-line premise of where the story ends up,
  - the rough arc in 3 to 4 broad beats, from the current situation toward that end,
  - which existing threads, unresolved setups or character traits it builds on (cite message numbers or summary events),
  - what this direction would bring out in the characters and their relationship, and the tone it gives the story.
- Stay at the level of arcs and turning points. Do NOT suggest the user's next reply, specific lines of dialogue, or what the user's persona should say or do next.
- Respect established characterization and canon. If the user names a mood or direction, shape every option around it.`,
    },
    swipes: {
        icon: '🔀', label: '스와이프 비교',
        placeholder: '비우고 보내면 스와이프를 비교해줘',
        defaultShown: '마지막 답변 스와이프 중에 뭐가 제일 나아?',
        defaultAsk: 'Compare the swipes of the latest reply. Which one is best?',
        prompt: `The context ends with a section listing every alternative version (swipe) of the latest AI reply. Compare them.
- For each swipe: what it does differently, how accurate the character voice is, how much it moves the story, and the prose quality. Keep each to a few lines.
- Then pick one and give the reasons. If none is good, say so and say what is missing.
- Refer to them as Swipe 1, Swipe 2, and so on.`,
    },
    critic: {
        icon: '⚖️', label: '비평가',
        placeholder: '비우면 전체 평. 범위를 적어도 돼',
        defaultShown: '지금까지의 챗을 비평해줘.',
        defaultAsk: 'Review the story so far.',
        prompt: `Act as a haughty, razor-tongued professional critic reviewing this roleplay as if it were a published work. The review is for the user's entertainment. This overrides the voice instruction: speak as a dry, composed reviewer, never as a friend. When replying in Korean, use polite but cutting sentences, for example endings like "-군요" and "-네요".
Be demanding by default. No flattery, no cushioning. But be fair: when something is truly excellent, admit it and praise it wholeheartedly, even if it visibly pains you to do so. Never nitpick just to have a complaint, and do not hold back a 9 or 10 that has been earned.
The wit must come from accurate observation: ground every remark in what actually happened, with message numbers or short quoted phrases. Do not invent flaws for the sake of a joke.
This is a review, not a repair manual. Do NOT give advice, fixes or suggestions for improvement unless the user asks for them.

Scoring scale, do not inflate:
1-2: broken. 3-4: notable recurring problems. 5: competent but unremarkable, the level of typical AI roleplay. 6: slightly above average. 7: clearly good. 8: excellent with minor flaws. 9-10: exceptional and rare.
Use summaries for arc-level judgments and the visible messages for prose-level judgments. If there is not enough evidence to judge a criterion, say so instead of guessing.

Fixed criteria, always all eight, in this order:
1. Character consistency
2. Plot and causality
3. Pacing
4. Prose quality (repetition, cliches, stock AI phrasing, overwriting)
5. Dialogue
6. Agency and collaboration (does the AI respect the user's control of their persona; do the user's own inputs give the story enough to work with)
7. Continuity
8. Emotional payoff and tension

Output format, compact enough for a narrow side panel (no tables):
- One line per criterion: the criterion name, the score out of 10, then one or two sharp sentences of commentary.
- Overall score (average, one decimal).
- A final verdict paragraph.
- One closing line written like a review headline.
If the user asks about a narrower scope, review only that scope with the same standards.`,
    },
    rx: {
        icon: '💊', label: '처방전',
        placeholder: '비우면 최근 답변들을 진찰해줘',
        defaultShown: '봇 상태 좀 진찰해줘. 고칠 데 있어?',
        defaultAsk: 'Examine the character AI\'s recent replies and tell me if anything actually needs fixing.',
        prompt: `Act as a roleplay doctor. Examine the AI-played character's recent replies (the visible messages; if the user quoted a message, focus on that one) for real, concrete problems only. Matters of taste are not problems.

Default checklist:
- Out of character: behavior, speech or values that clearly contradict the character sheet or the established history with no in-story reason.
- Setting conflicts: contradictions with the character sheet, the lore or the summaries.
- Internal contradictions: the story contradicting itself, such as timeline, location, who knows what, injuries, objects, promises.
- Loops: the same phrases, sentence structures or story beat repeating.

Do NOT report the AI narrating or acting for the user's persona, and do not report "sounding like an AI", unless the user's own checklist asks for it.
If the user's own checklist is given below, it has the highest priority: check every item on it first and report on each one, even when the result is "no problem found". For word or phrase checks, list every occurrence with its message number.

If nothing is wrong, say the character is healthy and stop. Do not invent problems.

Otherwise list at most 5 findings, most severe first. For each:
- Symptom: what happened, with the message number and a short quote.
- Diagnosis: why it is a problem, citing the character sheet, lore, history, or the user's checklist item.
- Prescription: a ready-to-paste instruction for the roleplay AI, written in English, one or two sentences, specific to this character and this problem. Put it in a code block so it can be copied.
Write the explanations in the reply language, but keep the paste-ready instruction in English.`,
    },
    ooc: {
        icon: '🩺', label: '캐붕 체크',
        placeholder: '메시지를 인용하거나 비우고 보내',
        defaultShown: '방금 답변 캐붕이야?',
        defaultAsk: 'Is the latest AI reply in character?',
        prompt: `Do a quick character check of one reply: the quoted message if the user quoted one, otherwise the latest AI reply.
- Start with the verdict, exactly one of: In character / Borderline / Out of character (translated into the reply language).
- Then 2 to 4 short lines of reasons, comparing the reply with the character sheet and the established history, quoting the specific part.
Keep it short. No fixes unless the user asks.`,
    },
    who: {
        icon: '🔎', label: '누구였지',
        placeholder: '이름이나 용어를 적어줘',
        defaultShown: '지금까지 나온 조연이랑 주요 용어 정리해줘.',
        defaultAsk: 'List the side characters and important terms so far, one line each.',
        prompt: `The user forgot who or what something is. Answer like a quick glossary card, 5 lines at most per entry:
- who or what it is,
- where it first appeared and its most relevant appearances (message numbers, or the summary if older),
- its relation to the main characters,
- its current status or what it was last seen doing.
If the material does not mention it, say so. If the user gives no name, list the named side characters and key terms so far, one line each.`,
    },
};

// ---------------------------------------------------------------------------
// Mascot: Sogoni, a little ghost with a bookmark-ribbon tail
// ---------------------------------------------------------------------------

const ASSET_BASE = new URL('./img/', import.meta.url).href;
const MASCOT_KINDS = ['default', 'critic', 'fan', 'think'];

function mascotSrc(kind) {
    return `${ASSET_BASE}sogoni-${MASCOT_KINDS.includes(kind) ? kind : 'default'}.png`;
}

/** Built-in mode or a user-made one (keys of custom modes start with "c_"). */
function getMode(key) {
    if (MODES[key]) return MODES[key];
    const custom = (getSettings().customModes ?? []).find(m => `c_${m.id}` === key);
    if (!custom) return null;
    return {
        icon: '✏️',
        label: custom.label || '커스텀',
        placeholder: custom.ask ? '비우고 보내면 기본 질문이 나가' : '뭐든 물어봐',
        defaultShown: custom.ask || '',
        defaultAsk: custom.ask || '',
        prompt: `This is a mode written by the user. Follow the user's instruction for this mode:\n${custom.prompt || ''}`,
        custom: true,
    };
}

function visibleModeKeys() {
    const s = getSettings();
    const hidden = s.hiddenModes ?? [];
    const keys = Object.keys(MODES).filter(k => k === 'free' || !hidden.includes(k));
    for (const m of s.customModes ?? []) keys.push(`c_${m.id}`);
    return keys;
}

function renderChips() {
    const box = document.getElementById('sk-modes');
    if (!box) return;
    box.replaceChildren();
    for (const key of visibleModeKeys()) {
        const m = getMode(key);
        if (!m) continue;
        const chip = el('button', 'sk-chip', `${m.icon} ${m.label}`);
        chip.type = 'button';
        chip.dataset.mode = key;
        box.append(chip);
    }
    setMode(visibleModeKeys().includes(state.mode) ? state.mode : 'free');
}

/** Which expression goes with which mode */
function mascotKindForMode(mode) {
    if (mode === 'critic') return 'critic';
    if (mode === 'fan') return 'fan';
    return 'default';
}

function mascotSvg(size = 24, kind = 'default') {
    return `<img class="sk-mascot" src="${mascotSrc(kind)}" width="${size}" height="${size}" alt="" draggable="false" />`;
}

function mascotNode(size, className = '', kind = 'default') {
    const span = document.createElement('span');
    span.className = `sk-mascot-wrap ${className}`.trim();
    span.innerHTML = mascotSvg(size, kind);
    return span;
}

// ---------------------------------------------------------------------------
// State / settings / storage
// ---------------------------------------------------------------------------

const state = {
    mode: 'free',
    quote: null,        // { mesid, text, partial }
    busy: false,
    runId: 0,
    abort: null,
    usingMainApi: false,
    lastSel: null,      // { text, mesid, t }
    pinsOnly: false,
};

function ctx() {
    return SillyTavern.getContext();
}

function getSettings() {
    const { extensionSettings } = ctx();
    if (!extensionSettings[MODULE]) {
        extensionSettings[MODULE] = structuredClone(defaultSettings);
    }
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE], key)) {
            extensionSettings[MODULE][key] = structuredClone(defaultSettings[key]);
        }
    }
    return extensionSettings[MODULE];
}

function saveSettings() {
    ctx().saveSettingsDebounced();
}

function hasChat() {
    return !!ctx().getCurrentChatId();
}

/** Side-chat log of the current chat. Stored in chat metadata, never in the chat itself. */
function getLog() {
    const { chatMetadata } = ctx();
    if (!chatMetadata) return [];
    if (!chatMetadata[MODULE] || !Array.isArray(chatMetadata[MODULE].log)) {
        chatMetadata[MODULE] = { log: [] };
    }
    return chatMetadata[MODULE].log;
}

function getChatState() {
    getLog(); // makes sure the per-chat object exists
    return ctx().chatMetadata?.[MODULE] ?? null;
}

/** Message index of the bookmark, following the message if indexes shifted. */
function resolveBookmark() {
    const st = getChatState();
    const bm = st?.bookmark;
    if (!bm) return null;
    const chat = ctx().chat ?? [];
    if (chat[bm.mesid] && chat[bm.mesid].send_date === bm.sendDate) return bm.mesid;
    const found = chat.findIndex(m => m && m.send_date === bm.sendDate);
    if (found >= 0) {
        bm.mesid = found;
        return found;
    }
    return null;
}

function setBookmark(mesid) {
    const st = getChatState();
    if (!st) return;
    const current = resolveBookmark();
    if (mesid === null || mesid === current) {
        delete st.bookmark;
        toastr.info('책갈피 뺐어.', '소곤이');
    } else {
        const message = ctx().chat?.[mesid];
        if (!message) return;
        st.bookmark = { mesid, sendDate: message.send_date };
        toastr.success(current === null ? `#${mesid}부터 집중해서 볼게.` : `책갈피를 #${mesid}로 옮겼어.`, '소곤이');
    }
    saveLog();
    applyBookmarkMarks();
}

function applyBookmarkMarks() {
    const bm = hasChat() ? resolveBookmark() : null;
    document.querySelectorAll('#chat .mes.sk-bookmarked').forEach(n => n.classList.remove('sk-bookmarked'));
    document.querySelectorAll('#chat .sk-bm-btn.fa-solid').forEach(n => n.classList.replace('fa-solid', 'fa-regular'));
    if (bm !== null) {
        const mes = document.querySelector(`#chat .mes[mesid="${bm}"]`);
        mes?.classList.add('sk-bookmarked');
        mes?.querySelector('.sk-bm-btn')?.classList.replace('fa-regular', 'fa-solid');
    }
    const row = document.getElementById('sk-bm');
    if (row) {
        row.hidden = bm === null;
        if (bm !== null) {
            const cardOnly = getSettings().rangeMode === 'card';
            row.querySelector('.sk-bm-text').textContent = cardOnly
                ? `#${bm}에 책갈피 (지금은 카드만 읽는 중이라 안 쓰여)`
                : `#${bm}부터 집중해서 보는 중`;
        }
    }
}

function saveLog() {
    if (hasChat()) ctx().saveMetadataDebounced();
}

// ---------------------------------------------------------------------------
// Context building: same material the character AI sees
// ---------------------------------------------------------------------------

const SKIP_INJECTION_KEYS = ['QUIET_PROMPT', 'PERSONA_DESCRIPTION', 'DEPTH_PROMPT'];

function section(title, body) {
    const text = String(body ?? '').trim();
    return text ? `<${title}>\n${text}\n</${title}>` : '';
}

/** Reading range "card": only the character sheet and the user's persona, no chat at all. */
function buildCardOnlyContext() {
    const c = ctx();
    let fields = {};
    try { fields = c.getCharacterCardFields() ?? {}; } catch (e) { console.warn(`[${MODULE}] card fields`, e); }
    const parts = [
        section('reading_mode', 'Card-only mode: you have only the character sheet and the user\'s persona below, not the chat itself. Answer from these alone and do not assume any story events.'),
        section('names', `User persona name: ${c.name1}\nMain AI character name: ${c.name2}`),
        section('character_description', fields.description),
        section('character_personality', fields.personality),
        section('scenario', fields.scenario),
        section('user_persona', fields.persona),
    ];
    return {
        text: parts.filter(Boolean).join('\n\n'),
        stats: { cardOnly: true, messages: 0, injectionCount: 0, loreChars: 0, swipeCount: 0, bookmark: null },
    };
}

async function buildStoryContext(mode) {
    const c = ctx();
    const s = getSettings();
    const chat = Array.isArray(c.chat) ? c.chat : [];

    if (s.rangeMode === 'card') {
        return buildCardOnlyContext();
    }

    // Visible messages = not hidden from the prompt (hidden ones have is_system = true)
    let visible = [];
    for (let i = 0; i < chat.length; i++) {
        const m = chat[i];
        if (!m || !String(m.mes ?? '').trim()) continue;
        if (m.is_system && s.rangeMode !== 'all') continue;
        visible.push({ i, m });
    }
    if (s.rangeMode === 'count') {
        visible = visible.slice(-Math.max(1, Number(s.rangeCount) || 1));
    } else if (s.rangeMode === 'tokens') {
        // Walk back from the newest message until the token budget is used up
        const budget = Math.max(200, Number(s.rangeTokens) || 0);
        let used = 0;
        let start = visible.length;
        while (start > 0) {
            const text = String(visible[start - 1].m.mes);
            let cost;
            try { cost = await c.getTokenCountAsync(text); } catch { cost = Math.ceil(text.length / 2); }
            if (used + cost > budget && start < visible.length) break;
            used += cost;
            start--;
        }
        visible = visible.slice(start);
    }

    // Bookmark: make sure everything from the bookmark onward is read, even if the range cut it
    const bookmark = resolveBookmark();
    if (bookmark !== null && (!visible.length || visible[0].i > bookmark)) {
        const fromBookmark = [];
        for (let i = bookmark; i < chat.length; i++) {
            const m = chat[i];
            if (!m || !String(m.mes ?? '').trim()) continue;
            if (m.is_system && s.rangeMode !== 'all' && i !== bookmark) continue;
            fromBookmark.push({ i, m });
        }
        if (fromBookmark.length > visible.length) visible = fromBookmark;
    }

    let fields = {};
    try { fields = c.getCharacterCardFields() ?? {}; } catch (e) { console.warn(`[${MODULE}] card fields`, e); }

    const parts = [];
    parts.push(section('names', `User persona name: ${c.name1}\nMain AI character name: ${c.name2}`));
    parts.push(section('character_description', fields.description));
    parts.push(section('character_personality', fields.personality));
    parts.push(section('scenario', fields.scenario));
    parts.push(section('character_note', fields.charDepthPrompt));
    parts.push(section('user_persona', fields.persona));

    // Active lore (dry run: no events, no timed-effect changes)
    let loreChars = 0;
    if (s.includeLore) {
        try {
            const scan = visible.map(x => `${x.m.name}: ${x.m.mes}`).reverse();
            const wi = await c.getWorldInfoPrompt(scan, c.maxContext, true, {
                personaDescription: fields.persona ?? '',
                characterDescription: fields.description ?? '',
                characterPersonality: fields.personality ?? '',
                characterDepthPrompt: fields.charDepthPrompt ?? '',
                scenario: fields.scenario ?? '',
                creatorNotes: fields.creatorNotes ?? '',
                trigger: 'normal',
            });
            const depthText = (wi?.worldInfoDepth ?? []).flatMap(e => e?.entries ?? []).join('\n');
            const lore = [wi?.worldInfoString, depthText].filter(Boolean).join('\n').trim();
            loreChars = lore.length;
            parts.push(section('active_lore', lore));
        } catch (e) {
            console.warn(`[${MODULE}] lore scan failed`, e);
        }
    }

    // Whatever other extensions inject into the prompt: summaries, author's note, memory...
    let injectionCount = 0;
    if (s.includeInjections) {
        const prompts = c.extensionPrompts ?? {};
        const blocks = [];
        for (const [key, value] of Object.entries(prompts)) {
            if (key === MODULE || SKIP_INJECTION_KEYS.includes(key) || key.startsWith('customDepthWI')) continue;
            let text = String(value?.value ?? '').trim();
            if (!text) continue;
            try { text = c.substituteParams(text); } catch { /* keep raw */ }
            blocks.push(`[source: ${key}]\n${text}`);
            injectionCount++;
        }
        parts.push(section('injected_memory_and_notes', blocks.join('\n\n')));
    }

    const lines = visible.map(({ i, m }) => `#${i}${i === bookmark ? ' [BOOKMARK]' : ''} [${m.is_user ? 'USER' : 'AI'}] ${m.name}: ${m.mes}`);
    const hiddenCount = chat.length - visible.length;
    const header = hiddenCount > 0
        ? `(${hiddenCount} older or hidden messages are not shown here; they are covered by the summaries above if any exist.)\n`
        : '';
    parts.push(section('visible_chat_messages', header + lines.join('\n\n')));

    // Swipe comparison: list all versions of the latest AI reply
    let swipeCount = 0;
    if (mode === 'swipes') {
        for (let i = chat.length - 1; i >= 0; i--) {
            const m = chat[i];
            if (!m || m.is_user || m.is_system) continue;
            const swipes = Array.isArray(m.swipes) ? m.swipes : [];
            swipeCount = swipes.length;
            if (swipeCount > 1) {
                const current = Number(m.swipe_id ?? 0);
                const text = swipes.map((sw, n) => `--- Swipe ${n + 1}${n === current ? ' (currently selected)' : ''} ---\n${sw}`).join('\n\n');
                parts.push(section(`swipes_of_message_${i}`, text));
            }
            break;
        }
    }

    return {
        text: parts.filter(Boolean).join('\n\n'),
        stats: {
            messages: visible.length,
            first: visible[0]?.i,
            last: visible[visible.length - 1]?.i,
            injectionCount,
            loreChars,
            swipeCount,
            bookmark,
        },
    };
}

/**
 * The system prompt comes in two parts:
 * - stable: identical between requests while the chat itself has not changed (cache-friendly prefix)
 * - dynamic: voice, mode and language, which change with every chip the user taps
 */
function buildSystemParts(storyContext, mode, bookmark = null) {
    const s = getSettings();
    const m = getMode(mode) ?? MODES.free;
    let voice = '';
    if (mode !== 'critic') {
        voice = s.persona === 'custom'
            ? (s.customPersona.trim() ? `Voice and personality (set by the user): ${s.customPersona.trim()}` : '')
            : (PERSONAS[s.persona]?.prompt ?? '');
    }
    const lang = String(s.replyLang || '').trim();
    let modePrompt = m.prompt;
    if (mode === 'rx' && String(s.rxCriteria ?? '').trim()) {
        modePrompt += `\n\nThe user's own checklist:\n${s.rxCriteria.trim()}`;
    }
    const stable = `${BASE_PROMPT}\n\n<story_context>\n${storyContext}\n</story_context>`;
    const dynamic = [
        '## How to respond now',
        voice,
        `Current mode: ${m.custom ? m.label : mode}\n${modePrompt}`,
        bookmark !== null
            ? `Focus: the user placed a bookmark at message #${bookmark}. Concentrate on the stretch from #${bookmark} to the latest message: weigh it most heavily and draw your examples from it. Everything before it is background for understanding that stretch.`
            : '',
        s.replyLength === 'short' ? 'Length: keep this reply brief. A few sentences at most; when the mode requires a fixed format, keep the format but make every item a single short line.' : '',
        s.replyLength === 'long' ? 'Length: be thorough and detailed in this reply.' : '',
        lang ? `Always reply in ${lang}.` : 'Reply in the language the user writes in.',
        mode === 'rx' ? 'Exception to the reply language: every paste-ready instruction inside a code block must be written in English, because it will be given to the roleplay AI. Only the symptom and diagnosis explanations use the reply language.' : '',
    ].filter(Boolean).join('\n\n');
    return { stable, dynamic };
}

/**
 * Explicit cache markers are only attached where they are known to pass through untouched:
 * a connection profile that talks to OpenRouter with a Claude or Gemini model.
 * Other providers either cache matching prefixes on their own or ignore caching entirely.
 */
/** Which connection profile a mode uses: the fast one if it is set and the mode is ticked, else the main one. */
function profileForMode(mode) {
    const s = getSettings();
    if (s.fastProfileId && (s.fastModes ?? []).includes(mode)) return s.fastProfileId;
    return s.profileId || '';
}

function canMarkCache(profileId) {
    const s = getSettings();
    if (!s.useCache || !profileId) return false;
    const profiles = ctx().extensionSettings?.connectionManager?.profiles ?? [];
    const profile = profiles.find(p => p.id === profileId);
    if (!profile || profile.api !== 'openrouter') return false;
    return /claude|anthropic|gemini/i.test(String(profile.model ?? ''));
}

function toApiText(item) {
    let text = item.sent || item.content || '';
    if (item.role === 'user' && item.quote?.text) {
        const where = item.quote.mesid !== undefined && item.quote.mesid !== null ? ` from message #${item.quote.mesid}` : '';
        const kind = item.quote.partial ? 'excerpt' : 'full text';
        text = `[The user is pointing at this ${kind}${where}]\n"""\n${item.quote.text}\n"""\n\n${text}`;
    }
    return text;
}

/** Turn the side-chat log into alternating user/assistant messages ending with the latest user turn. */
function buildTurns(log, mode) {
    const s = getSettings();
    // The critic judges independently: it gets only the current request, none of the side chat
    if (mode === 'critic') {
        const last = log[log.length - 1];
        return last ? [{ role: 'user', content: toApiText(last) }] : [];
    }
    // The newest request always goes out, even if older bubbles around it are hidden
    const recent = log.slice(-Math.max(1, Number(s.historyTurns) + 1));
    const turns = [];
    for (const item of recent) {
        if (item.error || item.hidden) continue;
        const role = item.role === 'assistant' ? 'assistant' : 'user';
        const text = toApiText(item);
        if (!text.trim()) continue;
        const prev = turns[turns.length - 1];
        if (prev && prev.role === role) prev.content += `\n\n${text}`;
        else turns.push({ role, content: text });
    }
    while (turns.length && turns[0].role !== 'user') turns.shift();
    return turns;
}

// ---------------------------------------------------------------------------
// Reply chime: synthesized, so it needs no sound file and differs from SillyTavern's own ding
// ---------------------------------------------------------------------------

let audioCtx = null;

/** Must run inside a click so phones allow sound later. */
function unlockAudio() {
    if (!getSettings().replySound) return;
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audioCtx = audioCtx ?? new Ctx();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { console.warn(`[${MODULE}] audio`, e); }
}

/** Two soft rising bell notes, like a little whisper "ti-ring". */
function playChime(force = false) {
    const s = getSettings();
    if (!force) {
        if (!s.replySound) return;
        const panelOpen = !document.getElementById('sk-panel')?.classList.contains('sk-hidden');
        const looking = panelOpen && document.visibilityState === 'visible';
        if (s.replySoundWhen !== 'always' && looking) return;
    }
    try {
        unlockAudio();
        if (!audioCtx) return;
        const now = audioCtx.currentTime + 0.02;
        const notes = [[1046.5, 0], [1568, 0.11]]; // C6 then G6
        for (const [freq, delay] of notes) {
            const osc = audioCtx.createOscillator();
            const shimmer = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            shimmer.type = 'triangle';
            osc.frequency.value = freq;
            shimmer.frequency.value = freq * 2;
            const start = now + delay;
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.16, start + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
            const shimmerGain = audioCtx.createGain();
            shimmerGain.gain.value = 0.18;
            osc.connect(gain);
            shimmer.connect(shimmerGain).connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(start);
            shimmer.start(start);
            osc.stop(start + 0.6);
            shimmer.stop(start + 0.6);
        }
    } catch (e) { console.warn(`[${MODULE}] chime`, e); }
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

async function requestCompletion(messages, profileId) {
    const c = ctx();
    const s = getSettings();
    if (profileId) {
        state.usingMainApi = false;
        state.abort = new AbortController();
        const res = await c.ConnectionManagerRequestService.sendRequest(
            profileId, messages, Number(s.maxTokens) || 8192,
            { stream: false, signal: state.abort.signal, extractData: true, includePreset: true, includeInstruct: true },
        );
        return typeof res === 'string' ? res : String(res?.content ?? '');
    }
    state.usingMainApi = true;
    return await c.generateRaw({ prompt: messages, responseLength: Number(s.maxTokens) || 8192, trimNames: false });
}

function errorText(e) {
    const cause = e?.cause?.message || e?.cause;
    const text = [e?.message, cause].filter(Boolean).join(': ') || String(e);
    if (/candidate text empty|빈 응답/i.test(text)) {
        return `${text}\n\n모델이 생각(추론)하는 데 토큰을 다 써서 답을 못 쓴 걸 수 있어. 톱니바퀴 > 모델 > "최대 응답 토큰"을 더 올리고 다시 보내봐. (지금 ${getSettings().maxTokens})`;
    }
    return text;
}

async function runGeneration() {
    const c = ctx();
    const log = getLog();
    const last = log[log.length - 1];
    if (!last || last.role !== 'user') return;
    const mode = last.mode || 'free';
    const chatId = c.getCurrentChatId();
    const runId = ++state.runId;
    unlockAudio();

    setBusy(true);
    try {
        const story = await buildStoryContext(mode);
        if (mode === 'swipes' && story.stats.swipeCount < 2) {
            toastr.info('마지막 AI 답변에 스와이프가 2개 이상 있어야 비교할 수 있어.', '소곤이');
            log.pop();
            saveLog();
            return;
        }
        const parts = buildSystemParts(story.text, mode, story.stats.bookmark ?? null);
        const system = `${parts.stable}\n\n${parts.dynamic}`;
        const profileId = profileForMode(mode);
        const systemContent = canMarkCache(profileId)
            ? [
                { type: 'text', text: parts.stable, cache_control: { type: 'ephemeral' } },
                { type: 'text', text: parts.dynamic },
            ]
            : system;
        const messages = [{ role: 'system', content: systemContent }, ...buildTurns(log, mode)];
        showStats(story.stats, system);

        const reply = (await requestCompletion(messages, profileId) ?? '').trim();
        if (runId !== state.runId) return; // stopped by the user
        if (ctx().getCurrentChatId() !== chatId) {
            toastr.warning('답변이 오기 전에 채팅이 바뀌어서 버렸어.', '소곤이');
            return;
        }
        if (!reply) throw new Error('빈 응답이 왔어. 최대 토큰이나 연결 프로필을 확인해줘.');
        log.push({ role: 'assistant', content: reply, mode, ts: Date.now() });
        saveLog();
        playChime();
    } catch (e) {
        if (runId !== state.runId) return;
        console.error(`[${MODULE}] generation failed`, e);
        if (ctx().getCurrentChatId() === chatId) {
            getLog().push({ role: 'assistant', content: `요청 실패: ${errorText(e)}`, error: true, mode, ts: Date.now() });
            saveLog();
        }
    } finally {
        if (runId === state.runId) {
            state.abort = null;
            setBusy(false);
            renderLog();
        }
    }
}

function stopGeneration() {
    if (!state.busy) return;
    state.runId++;
    try {
        if (state.abort) state.abort.abort();
        else if (state.usingMainApi) ctx().stopGeneration();
    } catch (e) { console.warn(`[${MODULE}] stop`, e); }
    state.abort = null;
    setBusy(false);
    renderLog();
}

function send() {
    if (state.busy) { stopGeneration(); return; }
    if (!hasChat()) { toastr.info('먼저 채팅을 열어줘.', '소곤이'); return; }
    const input = document.getElementById('sk-input');
    const typed = input.value.trim();
    const mode = getMode(state.mode) ? state.mode : 'free';
    const m = getMode(mode);
    if (!typed && !m.defaultAsk && !state.quote) return;

    const item = { role: 'user', mode, ts: Date.now() };
    if (typed) {
        item.content = typed;
    } else if (m.defaultAsk) {
        item.content = m.defaultShown;
        item.sent = m.defaultAsk;
    } else {
        item.content = '이 부분 설명해줘.';
        item.sent = 'Explain this part: what is happening and why.';
    }
    if (state.quote) item.quote = state.quote;

    getLog().push(item);
    saveLog();
    input.value = '';
    autoGrow(input);
    setQuote(null);
    renderLog();
    runGeneration();
}

function regenerate() {
    if (state.busy || !hasChat()) return;
    const log = getLog();
    while (log.length && log[log.length - 1].role === 'assistant') log.pop();
    if (!log.length) return;
    saveLog();
    renderLog();
    runGeneration();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

let mdConverter = null;

function renderMarkdown(text) {
    const { showdown, DOMPurify } = SillyTavern.libs;
    if (!mdConverter) {
        mdConverter = new showdown.Converter({
            simpleLineBreaks: true, tables: true, strikethrough: true,
            literalMidWordUnderscores: true, disableForced4SpacesIndentedSublists: true,
        });
    }
    return DOMPurify.sanitize(mdConverter.makeHtml(String(text ?? '')));
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function renderLog() {
    const box = document.getElementById('sk-log');
    if (!box) return;
    box.replaceChildren();

    if (!hasChat()) {
        const empty = el('div', 'sk-empty', '채팅을 열면 여기서 그 챗에 대해 얘기할 수 있어.');
        empty.prepend(mascotNode(96, 'sk-mascot-hero'));
        box.append(empty);
        return;
    }
    const log = getLog();
    if (state.pinsOnly && !log.some(item => item.pinned)) {
        box.append(el('div', 'sk-empty', '핀한 답변이 아직 없어.\n답변 아래의 압정을 누르면 여기에 모여.'));
    }
    if (!log.length && !state.pinsOnly) {
        const empty = el('div', 'sk-empty', '여기서 나눈 얘기는 채팅창에 안 보이고 캐릭터도 몰라.\n모드를 고르고 물어봐. 비우고 보내면 그 모드의 기본 질문이 나가.');
        empty.prepend(mascotNode(96, 'sk-mascot-hero', mascotKindForMode(state.mode)));
        box.append(empty);
    }

    log.forEach((item, index) => {
        if (state.pinsOnly && !item.pinned) return;
        const isUser = item.role === 'user';
        const wrap = el('div', `sk-msg ${isUser ? 'sk-user' : 'sk-ai'}${item.error ? ' sk-error' : ''}${item.pinned ? ' sk-pinned' : ''}${item.hidden ? ' sk-hidden-msg' : ''}`);

        const badgeMode = isUser && item.mode && item.mode !== 'free' ? getMode(item.mode) : null;
        if (badgeMode) {
            wrap.append(el('div', 'sk-badge', `${badgeMode.icon} ${badgeMode.label}`));
        }
        if (isUser && item.quote?.text) {
            const q = el('div', 'sk-msg-quote');
            const label = item.quote.mesid !== undefined && item.quote.mesid !== null ? `#${item.quote.mesid} ` : '';
            const short = item.quote.text.length > 160 ? `${item.quote.text.slice(0, 160)}…` : item.quote.text;
            q.textContent = `${label}${short}`;
            wrap.append(q);
        }
        const body = el('div', 'sk-body');
        if (isUser || item.error) body.textContent = item.content;
        else body.innerHTML = renderMarkdown(item.content);
        wrap.append(body);

        const tools = el('div', 'sk-tools');
        if (!isUser && !item.error) {
            const copy = el('i', 'fa-solid fa-copy');
            copy.title = '복사';
            copy.addEventListener('click', async () => {
                try { await navigator.clipboard.writeText(item.content); toastr.success('복사했어.', '소곤이'); }
                catch { toastr.error('복사 실패', '소곤이'); }
            });
            tools.append(copy);
            const pin = el('i', `fa-solid fa-thumbtack${item.pinned ? ' sk-on' : ''}`);
            pin.title = item.pinned ? '핀 해제' : '핀으로 고정';
            pin.addEventListener('click', () => {
                item.pinned = !item.pinned;
                saveLog();
                renderLog();
            });
            tools.append(pin);
        }
        if (!item.error) {
            const eye = el('i', `fa-solid ${item.hidden ? 'fa-eye-slash sk-on' : 'fa-eye'}`);
            eye.title = item.hidden ? '소곤이한테 다시 보이기' : '소곤이한테 숨기기 (지우진 않음)';
            eye.addEventListener('click', () => {
                if (state.busy) return;
                item.hidden = !item.hidden;
                saveLog();
                renderLog();
            });
            tools.append(eye);
        }
        if (!isUser && index === log.length - 1 && !state.pinsOnly) {
            const redo = el('i', 'fa-solid fa-rotate');
            redo.title = '다시 생성';
            redo.addEventListener('click', regenerate);
            tools.append(redo);
        }
        const del = el('i', 'fa-solid fa-xmark');
        del.title = '이 말풍선 삭제';
        del.addEventListener('click', async () => {
            if (state.busy) return;
            const { Popup, POPUP_RESULT } = ctx();
            const ok = await Popup.show.confirm('말풍선 삭제', '이 말풍선을 지울까? 되돌릴 수 없어.');
            if (ok !== POPUP_RESULT.AFFIRMATIVE || state.busy) return;
            const current = getLog();
            const at = current.indexOf(item);
            if (at >= 0) current.splice(at, 1);
            saveLog();
            renderLog();
        });
        tools.append(del);
        wrap.append(tools);
        box.append(wrap);
    });

    if (state.busy && !state.pinsOnly) {
        const pending = el('div', 'sk-msg sk-ai sk-pending');
        pending.append(mascotNode(30, 'sk-mascot-busy', 'think'), el('span', '', ' 읽고 생각하는 중…'));
        box.append(pending);
    }
    box.scrollTop = box.scrollHeight;
}

let statsTimer = null;

async function showStats(stats, system) {
    const node = document.getElementById('sk-status');
    if (!node || !getSettings().showStats) return;
    clearTimeout(statsTimer);
    statsTimer = setTimeout(() => { node.textContent = ''; }, 8000);
    const range = stats.messages ? ` (#${stats.first}~#${stats.last})` : '';
    const focus = stats.bookmark !== null && stats.bookmark !== undefined ? ` · 📑 #${stats.bookmark}부터 집중` : '';
    let text = stats.cardOnly
        ? '읽은 범위: 캐릭터 카드 + 내 페르소나만'
        : `읽은 범위: 메시지 ${stats.messages}개${range} · 요약/주입 ${stats.injectionCount}개 · 로어 ${stats.loreChars.toLocaleString()}자${focus}`;
    node.textContent = text;
    try {
        const tokens = await ctx().getTokenCountAsync(system);
        if (tokens) node.textContent = `${text} · 약 ${Number(tokens).toLocaleString()}토큰`;
    } catch { /* token count is optional */ }
}

function setBusy(busy) {
    state.busy = busy;
    const btn = document.getElementById('sk-send');
    if (btn) {
        btn.innerHTML = busy ? '<i class="fa-solid fa-stop"></i>' : '<i class="fa-solid fa-paper-plane"></i>';
        btn.title = busy ? '중지' : '보내기';
    }
    if (busy) renderLog();
}

function setQuote(quote) {
    state.quote = quote;
    const box = document.getElementById('sk-quote');
    if (!box) return;
    if (!quote) { box.hidden = true; return; }
    box.hidden = false;
    const label = quote.mesid !== undefined && quote.mesid !== null ? `#${quote.mesid}${quote.partial ? ' 일부' : ''}: ` : '';
    const short = quote.text.length > 120 ? `${quote.text.slice(0, 120)}…` : quote.text;
    box.querySelector('.sk-quote-text').textContent = `${label}${short}`;
}

function setMode(mode) {
    state.mode = getMode(mode) ? mode : 'free';
    const saved = getSettings();
    if (saved.lastMode !== state.mode) {
        saved.lastMode = state.mode;
        saveSettings();
    }
    document.querySelectorAll('#sk-modes .sk-chip').forEach(chip => {
        chip.classList.toggle('sk-active', chip.dataset.mode === state.mode);
    });
    const panel = document.getElementById('sk-panel');
    if (panel) panel.dataset.mode = state.mode;
    const kind = mascotKindForMode(state.mode);
    document.querySelectorAll('#sk-title-mascot .sk-mascot, #sk-log .sk-mascot-hero .sk-mascot').forEach(img => { img.src = mascotSrc(kind); });
    const input = document.getElementById('sk-input');
    if (input) input.placeholder = getMode(state.mode).placeholder;
}

function autoGrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function isNarrow() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function fitToViewport() {
    const panel = document.getElementById('sk-panel');
    if (!panel) return;
    const vv = window.visualViewport;
    if (isNarrow() && vv && !panel.classList.contains('sk-hidden')) {
        // Follow the on-screen keyboard on phones
        panel.style.height = `${vv.height}px`;
        panel.style.top = `${vv.offsetTop}px`;
    } else {
        panel.style.height = '';
        panel.style.top = '';
    }
}

function openPanel(focus = false) {
    const panel = document.getElementById('sk-panel');
    if (!panel) return;
    panel.classList.remove('sk-hidden');
    document.body.classList.add('sk-open');
    fitToViewport();
    renderLog();
    if (focus && !isNarrow()) document.getElementById('sk-input')?.focus();
}

function closePanel() {
    document.getElementById('sk-panel')?.classList.add('sk-hidden');
    document.body.classList.remove('sk-open');
}

function togglePanel() {
    const panel = document.getElementById('sk-panel');
    if (!panel) return;
    if (panel.classList.contains('sk-hidden')) openPanel(true);
    else closePanel();
}

function applyPanelWidth() {
    const width = Math.max(300, Math.min(900, Number(getSettings().panelWidth) || 420));
    document.documentElement.style.setProperty('--sk-width', `${width}px`);
}

function createPanel() {
    if (document.getElementById('sk-panel')) return;

    const html = `
    <div id="sk-panel" class="sk-hidden">
        <div class="sk-head">
            <span class="sk-title"><span id="sk-title-mascot">${mascotSvg(30)}</span> 소곤이</span>
            <span class="sk-head-btns">
                <i id="sk-pins" class="fa-solid fa-thumbtack" title="핀한 답변만 보기"></i>
                <i id="sk-gear" class="fa-solid fa-gear" title="소곤이 설정"></i>
                <i id="sk-clear" class="fa-solid fa-trash-can" title="이 챗의 수다 기록 지우기"></i>
                <i id="sk-close" class="fa-solid fa-xmark" title="닫기"></i>
            </span>
        </div>
        <div id="sk-modes"></div>
        <div id="sk-log"></div>
        <div id="sk-status"></div>
        <div id="sk-bm" hidden>
            <i class="fa-solid fa-bookmark"></i>
            <span class="sk-bm-text"></span>
            <i id="sk-bm-clear" class="fa-solid fa-xmark" title="책갈피 빼기"></i>
        </div>
        <div id="sk-quote" hidden>
            <i class="fa-solid fa-quote-left"></i>
            <span class="sk-quote-text"></span>
            <i id="sk-quote-clear" class="fa-solid fa-xmark" title="인용 취소"></i>
        </div>
        <div class="sk-inputrow">
            <button type="button" id="sk-quote-btn" title="채팅에서 드래그한 문장 인용"><i class="fa-solid fa-quote-left"></i></button>
            <textarea id="sk-input" rows="1"></textarea>
            <button type="button" id="sk-send" title="보내기"><i class="fa-solid fa-paper-plane"></i></button>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);

    const panel = document.getElementById('sk-panel');
    const input = document.getElementById('sk-input');

    document.getElementById('sk-close').addEventListener('click', closePanel);
    document.getElementById('sk-gear').addEventListener('click', () => toggleSettings());
    document.getElementById('sk-pins').addEventListener('click', () => {
        state.pinsOnly = !state.pinsOnly;
        document.getElementById('sk-pins').classList.toggle('sk-on', state.pinsOnly);
        toggleSettings(false);
        renderLog();
    });
    document.getElementById('sk-send').addEventListener('click', send);
    document.getElementById('sk-quote-clear').addEventListener('click', () => setQuote(null));
    document.getElementById('sk-bm-clear').addEventListener('click', () => setBookmark(null));
    document.getElementById('sk-quote-btn').addEventListener('click', quoteSelection);
    document.getElementById('sk-clear').addEventListener('click', async () => {
        if (state.busy || !hasChat() || !getLog().length) return;
        const { Popup, POPUP_RESULT } = ctx();
        const ok = await Popup.show.confirm('수다 기록 지우기', '이 챗에서 소곤이랑 나눈 대화를 지울까? 핀한 답변은 남겨둘게. 채팅 본문은 그대로야.');
        if (ok !== POPUP_RESULT.AFFIRMATIVE) return;
        const kept = getLog().filter(item => item.pinned);
        getLog().length = 0;
        getLog().push(...kept);
        saveLog();
        document.getElementById('sk-status').textContent = '';
        renderLog();
    });
    document.getElementById('sk-modes').addEventListener('click', (e) => {
        const chip = e.target.closest('.sk-chip');
        if (chip) setMode(chip.dataset.mode);
    });

    input.addEventListener('input', () => autoGrow(input));
    input.addEventListener('keydown', (e) => {
        // Korean IME: never send while a syllable is still being composed
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter' && !e.shiftKey && !ctx().isMobile()) {
            e.preventDefault();
            send();
        }
    });
    // Keep SillyTavern hotkeys (swipe arrows, etc.) from reacting to typing in the panel
    for (const type of ['keydown', 'keyup', 'keypress']) {
        panel.addEventListener(type, (e) => e.stopPropagation());
    }

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', fitToViewport);
        window.visualViewport.addEventListener('scroll', fitToViewport);
    }
    window.addEventListener('resize', () => { fitToViewport(); clampFab(); });

    renderChips();
    applyPanelWidth();
}

// ---------------------------------------------------------------------------
// Quoting: message button + dragged selection
// ---------------------------------------------------------------------------

function trackSelection() {
    document.addEventListener('selectionchange', () => {
        const sel = window.getSelection();
        const text = sel ? sel.toString().trim() : '';
        if (!text || !sel.anchorNode) return;
        const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
        const mes = node?.closest?.('#chat .mes');
        if (!mes) return;
        state.lastSel = { text, mesid: Number(mes.getAttribute('mesid')), t: Date.now() };
    });
}

function quoteSelection() {
    const sel = state.lastSel;
    if (!sel || Date.now() - sel.t > SELECTION_TTL_MS) {
        toastr.info('채팅에서 문장을 드래그해서 선택한 다음 눌러줘.', '소곤이');
        return;
    }
    setQuote({ mesid: sel.mesid, text: sel.text.slice(0, QUOTE_MAX_CHARS), partial: true });
    state.lastSel = null;
}

function quoteMessage(mesid) {
    const message = ctx().chat?.[mesid];
    if (!message) return;
    const sel = state.lastSel;
    if (sel && sel.mesid === mesid && Date.now() - sel.t < 60 * 1000) {
        setQuote({ mesid, text: sel.text.slice(0, QUOTE_MAX_CHARS), partial: true });
        state.lastSel = null;
    } else {
        const full = String(message.mes ?? '');
        setQuote({ mesid, text: full.slice(0, QUOTE_MAX_CHARS), partial: full.length > QUOTE_MAX_CHARS });
    }
    openPanel(true);
}

function addMessageButtons() {
    const make = () => {
        const btn = document.createElement('div');
        btn.className = 'mes_button sk-ask-btn fa-solid fa-comment-dots';
        btn.title = '소곤이에게 이 메시지 물어보기';
        return btn;
    };
    const makeBookmark = () => {
        const btn = document.createElement('div');
        btn.className = 'mes_button sk-bm-btn fa-regular fa-bookmark';
        btn.title = '소곤이 책갈피: 여기부터 집중해서 보기';
        return btn;
    };
    const targets = document.querySelectorAll('#message_template .extraMesButtons, #chat .mes .extraMesButtons');
    targets.forEach(holder => {
        if (!holder.querySelector('.sk-bm-btn')) holder.prepend(makeBookmark());
        if (!holder.querySelector('.sk-ask-btn')) holder.prepend(make());
    });
    document.addEventListener('click', (e) => {
        const bmBtn = e.target.closest?.('.sk-bm-btn');
        if (bmBtn) {
            const mesid = Number(bmBtn.closest('.mes')?.getAttribute('mesid'));
            if (Number.isInteger(mesid) && hasChat()) setBookmark(mesid);
            return;
        }
        const btn = e.target.closest?.('.sk-ask-btn');
        if (!btn) return;
        const mes = btn.closest('.mes');
        const mesid = Number(mes?.getAttribute('mesid'));
        if (Number.isInteger(mesid)) quoteMessage(mesid);
    });
}

// ---------------------------------------------------------------------------
// Launchers: floating button + wand menu entry
// ---------------------------------------------------------------------------

function clampFab() {
    const fab = document.getElementById('sk-fab');
    if (!fab || fab.style.display === 'none') return;
    const s = getSettings();
    const size = fab.offsetWidth || 44;
    let pos = s.fabPos;
    if (!pos) {
        // Default spot: just inside the chat column, right above the input bar
        const sheld = document.getElementById('sheld')?.getBoundingClientRect();
        const form = document.getElementById('form_sheld')?.getBoundingClientRect();
        if (!sheld || !sheld.width) return;
        const inset = 12;
        pos = {
            left: s.fabSide === 'left' ? sheld.left + inset : sheld.right - size - inset,
            top: (form && form.height ? form.top : window.innerHeight - 60) - size - inset,
        };
    }
    const left = Math.max(4, Math.min(window.innerWidth - size - 4, pos.left));
    const top = Math.max(4, Math.min(window.innerHeight - size - 4, pos.top));
    fab.style.left = `${left}px`;
    fab.style.top = `${top}px`;
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
}

function createFab() {
    if (document.getElementById('sk-fab')) return;
    const fab = document.createElement('div');
    fab.id = 'sk-fab';
    fab.title = '소곤이 열기/닫기 (드래그로 이동)';
    fab.innerHTML = mascotSvg(40);
    document.body.append(fab);

    let drag = null;
    fab.addEventListener('pointerdown', (e) => {
        const rect = fab.getBoundingClientRect();
        drag = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top, moved: false };
        fab.setPointerCapture(e.pointerId);
    });
    fab.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 8) return;
        drag.moved = true;
        getSettings().fabPos = { left: drag.left + dx, top: drag.top + dy };
        clampFab();
    });
    const end = (e) => {
        if (!drag) return;
        const moved = drag.moved;
        drag = null;
        try { fab.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        if (moved) saveSettings();
        else if (e.type === 'pointerup') togglePanel();
    };
    fab.addEventListener('pointerup', end);
    fab.addEventListener('pointercancel', end);

    applyFabVisibility();
    clampFab();
}

function applyFabVisibility() {
    const fab = document.getElementById('sk-fab');
    if (fab) fab.style.display = getSettings().showFab ? '' : 'none';
    clampFab();
}

function addInputIcon() {
    const holder = document.getElementById('leftSendForm');
    if (!holder || document.getElementById('sk-inputbtn')) return;
    const btn = document.createElement('div');
    btn.id = 'sk-inputbtn';
    btn.className = 'fa-solid fa-comments interactable';
    btn.title = '소곤이 열기/닫기';
    btn.tabIndex = 0;
    btn.addEventListener('click', () => togglePanel());
    holder.append(btn);
    applyInputIconVisibility();
}

function applyInputIconVisibility() {
    const btn = document.getElementById('sk-inputbtn');
    if (btn) btn.style.display = getSettings().showInputIcon ? '' : 'none';
}

function addWandMenuEntry() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('sk-wand')) return;
    const item = document.createElement('div');
    item.id = 'sk-wand';
    item.className = 'list-group-item flex-container flexGap5';
    item.innerHTML = '<div class="fa-solid fa-comments extensionsMenuExtensionButton"></div><span>소곤이</span>';
    item.addEventListener('click', () => togglePanel());
    menu.append(item);
}

// ---------------------------------------------------------------------------
// Settings UI
// ---------------------------------------------------------------------------

function toggleSettings(show) {
    const panel = document.getElementById('sk-panel');
    const box = document.getElementById('sk-settings');
    if (!panel || !box) return;
    const open = show ?? box.hidden;
    box.hidden = !open;
    panel.classList.toggle('sk-show-settings', open);
    document.getElementById('sk-gear')?.classList.toggle('sk-on', open);
    if (!open) renderLog();
}

// ---------------------------------------------------------------------------
// Backup: export / import the side chat of the current chat only
// ---------------------------------------------------------------------------

function downloadText(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function backupFileName(ext) {
    const name = String(ctx().name2 || 'chat').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `sogoni_${name}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
}

function exportBackup(kind) {
    if (!hasChat()) { toastr.info('먼저 채팅을 열어줘.', '소곤이'); return; }
    const log = getLog().filter(item => !item.error);
    if (!log.length) { toastr.info('이 챗엔 저장할 소곤이 대화가 없어.', '소곤이'); return; }
    if (kind === 'json') {
        const data = { app: 'sogoni', version: 1, exportedAt: new Date().toISOString(), character: ctx().name2 ?? '', log };
        downloadText(backupFileName('json'), JSON.stringify(data, null, 2), 'application/json');
    } else {
        const lines = log.map((item) => {
            const who = item.role === 'user' ? '나' : '소곤이';
            const m = item.role === 'user' && item.mode && item.mode !== 'free' ? getMode(item.mode) : null;
            const head = `[${who}${m ? ` · ${m.label}` : ''}${item.pinned ? ' · 핀' : ''}]`;
            const quote = item.quote?.text ? `> ${item.quote.mesid ?? ''} ${item.quote.text}`.replace(/\n/g, '\n> ') + '\n' : '';
            return `${head}\n${quote}${item.content}`;
        });
        downloadText(backupFileName('txt'), lines.join('\n\n----------\n\n') + '\n', 'text/plain');
    }
    toastr.success('저장했어.', '소곤이');
}

/** Keep only the fields Sogoni itself writes, so a hand-edited or foreign file cannot inject anything odd. */
function cleanImportedItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.role !== 'user' && raw.role !== 'assistant') return null;
    if (typeof raw.content !== 'string' || !raw.content.trim()) return null;
    const item = { role: raw.role, content: raw.content, ts: Number(raw.ts) || Date.now() };
    if (typeof raw.mode === 'string') item.mode = raw.mode;
    if (typeof raw.sent === 'string') item.sent = raw.sent;
    if (raw.pinned === true) item.pinned = true;
    if (raw.hidden === true) item.hidden = true;
    if (raw.quote && typeof raw.quote.text === 'string') {
        item.quote = { text: raw.quote.text.slice(0, QUOTE_MAX_CHARS), partial: !!raw.quote.partial };
        if (Number.isInteger(raw.quote.mesid)) item.quote.mesid = raw.quote.mesid;
    }
    return item;
}

async function importBackup(file) {
    if (!file) return;
    if (!hasChat()) { toastr.info('먼저 채팅을 열어줘.', '소곤이'); return; }
    if (state.busy) { toastr.info('소곤이가 답하는 중이야. 끝나고 다시 해줘.', '소곤이'); return; }
    try {
        const data = JSON.parse(await file.text());
        const source = Array.isArray(data) ? data : data?.log;
        if (!Array.isArray(source)) throw new Error('소곤이 백업 파일이 아니야.');
        const items = source.map(cleanImportedItem).filter(Boolean);
        if (!items.length) throw new Error('불러올 대화가 없어.');
        getLog().push(...items);
        saveLog();
        toggleSettings(false);
        toastr.success(`말풍선 ${items.length}개를 불러왔어.`, '소곤이');
    } catch (e) {
        console.error(`[${MODULE}] import failed`, e);
        toastr.error(`불러오기 실패: ${e?.message ?? e}`, '소곤이');
    }
}

function bindBackupButtons() {
    const file = document.getElementById('sk-backup-file');
    document.getElementById('sk-backup-json').addEventListener('click', () => exportBackup('json'));
    document.getElementById('sk-backup-txt').addEventListener('click', () => exportBackup('txt'));
    document.getElementById('sk-backup-load').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
        await importBackup(file.files?.[0]);
        file.value = '';
    });
}

/** Checkboxes choosing which modes answer with the fast profile. */
function renderFastModes() {
    const s = getSettings();
    const box = document.getElementById('sk-set-fastmodes');
    if (!box) return;
    box.replaceChildren();
    if (!s.fastProfileId) return;
    const keys = [...Object.keys(MODES), ...(s.customModes ?? []).map(m => `c_${m.id}`)];
    for (const key of keys) {
        const m = getMode(key);
        if (!m) continue;
        const label = el('label', 'checkbox_label');
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = s.fastModes.includes(key);
        check.addEventListener('change', () => {
            s.fastModes = s.fastModes.filter(k => k !== key);
            if (check.checked) s.fastModes.push(key);
            saveSettings();
        });
        label.append(check, el('span', '', `${m.icon} ${m.label}`));
        box.append(label);
    }
}

function renderChipSettings() {
    renderFastModes();
    const s = getSettings();
    const chipBox = document.getElementById('sk-set-chips');
    const customBox = document.getElementById('sk-set-custom');
    if (!chipBox || !customBox) return;

    chipBox.replaceChildren();
    for (const [key, m] of Object.entries(MODES)) {
        if (key === 'free') continue;
        const label = el('label', 'checkbox_label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !s.hiddenModes.includes(key);
        box.addEventListener('change', () => {
            s.hiddenModes = s.hiddenModes.filter(k => k !== key);
            if (!box.checked) s.hiddenModes.push(key);
            saveSettings();
            renderChips();
        });
        label.append(box, el('span', '', `${m.icon} ${m.label}`));
        chipBox.append(label);
    }

    customBox.replaceChildren();
    s.customModes.forEach((mode) => {
        const card = el('div', 'sk-custom-card');
        const name = document.createElement('input');
        name.type = 'text';
        name.className = 'text_pole';
        name.placeholder = '칩 이름 (예: 떡밥 노트)';
        name.value = mode.label;
        name.addEventListener('input', () => { mode.label = name.value; saveSettings(); renderChips(); });

        const prompt = document.createElement('textarea');
        prompt.className = 'text_pole';
        prompt.rows = 4;
        prompt.placeholder = '소곤이한테 시킬 일 (예: 아직 안 풀린 복선, 약속, 비밀을 목록으로 뽑아줘)';
        prompt.value = mode.prompt;
        prompt.addEventListener('input', () => { mode.prompt = prompt.value; saveSettings(); });

        const ask = document.createElement('input');
        ask.type = 'text';
        ask.className = 'text_pole';
        ask.placeholder = '비우고 보냈을 때 나갈 기본 질문 (선택)';
        ask.value = mode.ask;
        ask.addEventListener('input', () => { mode.ask = ask.value; saveSettings(); });

        const remove = el('button', 'menu_button', '삭제');
        remove.type = 'button';
        remove.addEventListener('click', () => {
            s.customModes = s.customModes.filter(m => m !== mode);
            saveSettings();
            renderChipSettings();
            renderChips();
        });
        card.append(name, prompt, ask, remove);
        customBox.append(card);
    });
}

/** Settings live inside the panel (gear icon), not in the Extensions list. */
function createSettingsUI() {
    const panel = document.getElementById('sk-panel');
    if (!panel || document.getElementById('sk-settings')) return;
    const personaOptions = Object.entries(PERSONAS).map(([key, p]) => `<option value="${key}">${p.label}</option>`).join('');
    const html = `
    <div id="sk-settings" hidden>
        <div class="sk-settings-head">
            <b>소곤이 설정</b>
            <button type="button" id="sk-settings-back" class="menu_button"><i class="fa-solid fa-arrow-left"></i> 돌아가기</button>
        </div>

        <h4>모델</h4>
        <label for="sk-set-profile">연결 프로필 (비우면 현재 메인 API 사용)</label>
        <select id="sk-set-profile" class="text_pole"></select>
        <label for="sk-set-fastprofile">빠른 모델 프로필 (선택. 아래에서 고른 모드만 이걸로 답해)</label>
        <select id="sk-set-fastprofile" class="text_pole"></select>
        <div id="sk-set-fastmodes"></div>
        <label for="sk-set-maxtokens">최대 응답 토큰 (생각하는 모델은 추론 토큰도 여기서 나가)</label>
        <input id="sk-set-maxtokens" class="text_pole" type="number" min="200" max="32000" step="100" />

        <h4>읽는 범위</h4>
        <label for="sk-set-rangemode">소곤이가 읽는 채팅 범위</label>
        <select id="sk-set-rangemode" class="text_pole">
            <option value="same">캐릭터와 똑같이 (숨김 안 된 메시지 전부)</option>
            <option value="count">최근 메시지 N개만</option>
            <option value="tokens">최근 메시지를 약 N토큰까지만</option>
            <option value="all">숨긴 메시지까지 전부 (토큰 많이 듦)</option>
            <option value="card">캐릭터 카드 + 내 페르소나만 (채팅은 안 읽음)</option>
        </select>
        <div id="sk-set-rangecount-row">
            <label for="sk-set-rangecount">읽을 메시지 개수</label>
            <input id="sk-set-rangecount" class="text_pole" type="number" min="1" max="5000" step="1" />
        </div>
        <div id="sk-set-rangetokens-row">
            <label for="sk-set-rangetokens">채팅에 쓸 토큰 한도</label>
            <input id="sk-set-rangetokens" class="text_pole" type="number" min="200" max="1000000" step="500" />
        </div>
        <label class="checkbox_label"><input id="sk-set-injections" type="checkbox" /><span>요약 확장 등 다른 확장이 주입하는 내용 읽기</span></label>
        <label class="checkbox_label"><input id="sk-set-lore" type="checkbox" /><span>활성화된 로어북 읽기</span></label>
        <div class="sk-sound-row">
            <label class="checkbox_label"><input id="sk-set-sound" type="checkbox" /><span>소곤이 답장이 오면 띠링 소리</span></label>
            <button type="button" id="sk-set-sound-test" class="menu_button">미리 듣기</button>
        </div>
        <select id="sk-set-soundwhen" class="text_pole">
            <option value="away">패널을 안 보고 있을 때만 (닫혀 있거나 다른 탭·앱)</option>
            <option value="always">항상</option>
        </select>
        <label class="checkbox_label"><input id="sk-set-stats" type="checkbox" /><span>보낼 때마다 읽은 범위와 토큰을 잠깐 표시 (8초 뒤 사라짐)</span></label>
        <label class="checkbox_label"><input id="sk-set-cache" type="checkbox" /><span>프롬프트 캐싱 표시 붙이기 (소곤이 요청에만)</span></label>
        <small>연결 프로필이 OpenRouter의 Claude/Gemini일 때만 붙어. 그 외 모델은 켜도 달라지는 게 없어. 롤플 요청은 안 건드려.</small>
        <label for="sk-set-history">소곤이와의 대화 기억 개수 (최근 말풍선 몇 개까지)</label>
        <input id="sk-set-history" class="text_pole" type="number" min="0" max="60" step="1" />

        <h4>성격</h4>
        <label for="sk-set-persona">소곤이 말투</label>
        <select id="sk-set-persona" class="text_pole">${personaOptions}</select>
        <textarea id="sk-set-custompersona" class="text_pole" rows="3" placeholder="예: 츤데레 선배처럼 툭툭 던지는 말투"></textarea>
        <label for="sk-set-length">답변 길이</label>
        <select id="sk-set-length" class="text_pole">
            <option value="auto">모드에 맞게 (덕톡은 짧게 주고받기)</option>
            <option value="short">항상 짧게</option>
            <option value="long">항상 자세하게</option>
        </select>
        <label for="sk-set-lang">답변 언어 (영어로 적기: Korean, English, Japanese... 비우면 질문 언어를 따라감)</label>
        <input id="sk-set-lang" class="text_pole" type="text" />

        <h4>모드 칩</h4>
        <small>안 쓰는 칩은 체크를 풀면 숨겨져.</small>
        <div id="sk-set-chips"></div>
        <label for="sk-set-rx">💊 처방전에서 꼭 봐줄 내 기준 (선택)</label>
        <textarea id="sk-set-rx" class="text_pole" rows="4" placeholder="한 줄에 하나씩. 예:&#10;'전율'이라는 단어를 썼는지&#10;존댓말 캐릭터가 반말을 섞는지&#10;시간대가 밤인데 낮 묘사를 하는지"></textarea>
        <label>내가 만든 모드</label>
        <div id="sk-set-custom"></div>
        <button type="button" id="sk-set-custom-add" class="menu_button"><i class="fa-solid fa-plus"></i> 모드 추가</button>

        <h4>화면</h4>
        <label class="checkbox_label"><input id="sk-set-fab" type="checkbox" /><span>떠 있는 열기 버튼 표시</span></label>
        <label for="sk-set-fabside">떠 있는 버튼 위치 (바꾸면 드래그한 위치는 초기화)</label>
        <select id="sk-set-fabside" class="text_pole">
            <option value="right">채팅창 오른쪽 아래</option>
            <option value="left">채팅창 왼쪽 아래</option>
        </select>
        <label class="checkbox_label"><input id="sk-set-inputicon" type="checkbox" /><span>입력창에 열기 아이콘 표시</span></label>
        <small>둘 다 꺼도 요술봉 메뉴의 "소곤이"로 열 수 있어.</small>
        <label for="sk-set-width">PC 패널 너비 (px)</label>
        <input id="sk-set-width" class="text_pole" type="number" min="300" max="900" step="10" />

        <h4>백업 (지금 열린 챗의 소곤이 대화만)</h4>
        <div class="sk-backup-row">
            <button type="button" id="sk-backup-json" class="menu_button">백업 파일 저장</button>
            <button type="button" id="sk-backup-txt" class="menu_button">읽기용 텍스트 저장</button>
            <button type="button" id="sk-backup-load" class="menu_button">백업 불러오기</button>
        </div>
        <input id="sk-backup-file" type="file" accept=".json,application/json" hidden />
        <small>백업 파일(.json)은 다시 불러올 수 있고, 텍스트(.txt)는 읽기 전용이야. 불러오면 지금 대화 뒤에 덧붙여져.</small>
    </div>`;
    panel.querySelector('.sk-head').insertAdjacentHTML('afterend', html);
    document.getElementById('sk-settings-back').addEventListener('click', () => toggleSettings(false));

    const s = getSettings();
    const bindNumber = (id, key, after) => {
        const node = document.getElementById(id);
        node.value = s[key];
        node.addEventListener('change', () => {
            const value = Number(node.value);
            if (Number.isFinite(value)) { s[key] = value; saveSettings(); after?.(); }
        });
    };
    const bindCheck = (id, key, after) => {
        const node = document.getElementById(id);
        node.checked = !!s[key];
        node.addEventListener('change', () => { s[key] = node.checked; saveSettings(); after?.(); });
    };
    bindNumber('sk-set-maxtokens', 'maxTokens');
    bindNumber('sk-set-rangecount', 'rangeCount');
    bindNumber('sk-set-rangetokens', 'rangeTokens');
    bindNumber('sk-set-history', 'historyTurns');
    bindNumber('sk-set-width', 'panelWidth', applyPanelWidth);
    bindCheck('sk-set-injections', 'includeInjections');
    bindCheck('sk-set-lore', 'includeLore');
    bindCheck('sk-set-cache', 'useCache');
    bindCheck('sk-set-sound', 'replySound', () => unlockAudio());
    document.getElementById('sk-set-sound-test').addEventListener('click', () => playChime(true));
    const soundWhen = document.getElementById('sk-set-soundwhen');
    soundWhen.value = s.replySoundWhen === 'always' ? 'always' : 'away';
    soundWhen.addEventListener('change', () => { s.replySoundWhen = soundWhen.value; saveSettings(); });
    bindCheck('sk-set-stats', 'showStats', () => { const n = document.getElementById('sk-status'); if (n) n.textContent = ''; });
    bindCheck('sk-set-fab', 'showFab', applyFabVisibility);
    bindCheck('sk-set-inputicon', 'showInputIcon', applyInputIconVisibility);

    bindBackupButtons();
    renderChipSettings();
    const rx = document.getElementById('sk-set-rx');
    rx.value = s.rxCriteria ?? '';
    rx.addEventListener('input', () => { s.rxCriteria = rx.value; saveSettings(); });
    document.getElementById('sk-set-custom-add').addEventListener('click', () => {
        s.customModes.push({ id: Date.now().toString(36), label: '', prompt: '', ask: '' });
        saveSettings();
        renderChipSettings();
        renderChips();
    });

    const range = document.getElementById('sk-set-rangemode');
    const syncRange = () => {
        document.getElementById('sk-set-rangecount-row').style.display = s.rangeMode === 'count' ? '' : 'none';
        document.getElementById('sk-set-rangetokens-row').style.display = s.rangeMode === 'tokens' ? '' : 'none';
    };
    range.value = ['same', 'count', 'tokens', 'all', 'card'].includes(s.rangeMode) ? s.rangeMode : 'same';
    syncRange();
    range.addEventListener('change', () => { s.rangeMode = range.value; saveSettings(); syncRange(); applyBookmarkMarks(); });

    const side = document.getElementById('sk-set-fabside');
    side.value = s.fabSide === 'left' ? 'left' : 'right';
    side.addEventListener('change', () => { s.fabSide = side.value; s.fabPos = null; saveSettings(); clampFab(); });

    const persona = document.getElementById('sk-set-persona');
    const custom = document.getElementById('sk-set-custompersona');
    const syncCustom = () => { custom.style.display = s.persona === 'custom' ? '' : 'none'; };
    persona.value = PERSONAS[s.persona] ? s.persona : 'friend';
    custom.value = s.customPersona;
    syncCustom();
    persona.addEventListener('change', () => { s.persona = persona.value; saveSettings(); syncCustom(); });
    custom.addEventListener('input', () => { s.customPersona = custom.value; saveSettings(); });

    const length = document.getElementById('sk-set-length');
    length.value = ['auto', 'short', 'long'].includes(s.replyLength) ? s.replyLength : 'auto';
    length.addEventListener('change', () => { s.replyLength = length.value; saveSettings(); });

    const lang = document.getElementById('sk-set-lang');
    lang.value = s.replyLang;
    lang.addEventListener('input', () => { s.replyLang = lang.value; saveSettings(); });

    // Connection profile dropdown (built-in Connection Profiles extension)
    const select = document.getElementById('sk-set-profile');
    try {
        ctx().ConnectionManagerRequestService.handleDropdown(
            '#sk-set-profile',
            s.profileId,
            (profile) => { s.profileId = profile?.id ?? ''; saveSettings(); },
        );
        const first = select.querySelector('option[value=""]');
        if (first) { first.textContent = '(현재 메인 API 사용)'; delete first.dataset.i18n; }
        ctx().ConnectionManagerRequestService.handleDropdown(
            '#sk-set-fastprofile',
            s.fastProfileId,
            (profile) => { s.fastProfileId = profile?.id ?? ''; saveSettings(); renderFastModes(); },
        );
        const fastFirst = document.querySelector('#sk-set-fastprofile option[value=""]');
        if (fastFirst) { fastFirst.textContent = '(안 씀: 전부 위 프로필로)'; delete fastFirst.dataset.i18n; }
    } catch (e) {
        console.warn(`[${MODULE}] connection profiles unavailable`, e);
        select.innerHTML = '<option value="">(연결 프로필 확장이 꺼져 있음: 메인 API 사용)</option>';
        select.disabled = true;
        const fast = document.getElementById('sk-set-fastprofile');
        fast.innerHTML = '<option value="">(연결 프로필 확장이 꺼져 있음)</option>';
        fast.disabled = true;
    }
    renderFastModes();
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
    const { eventSource, event_types } = ctx();
    const settings = getSettings();
    if (settings.layoutVersion < 2) {
        // The default spot of the floating button changed; drop positions saved by older builds
        settings.fabPos = null;
        settings.layoutVersion = 2;
        saveSettings();
    }
    if (settings.layoutVersion < 3) {
        // 3000 was too small for thinking models: reasoning could use it all up and leave no answer
        if (Number(settings.maxTokens) <= 3000) settings.maxTokens = 8192;
        settings.layoutVersion = 3;
        saveSettings();
    }
    state.mode = settings.lastMode || 'free';
    createPanel();
    createFab();
    addWandMenuEntry();
    addInputIcon();
    addMessageButtons();
    trackSelection();
    createSettingsUI();

    eventSource.on(event_types.CHAT_CHANGED, () => {
        if (state.busy) stopGeneration();
        setQuote(null);
        state.lastSel = null;
        const status = document.getElementById('sk-status');
        if (status) status.textContent = '';
        renderLog();
        applyBookmarkMarks();
        clampFab();
    });
    for (const type of ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MORE_MESSAGES_LOADED', 'MESSAGE_DELETED']) {
        if (event_types[type]) eventSource.on(event_types[type], () => applyBookmarkMarks());
    }
    renderLog();
    applyBookmarkMarks();
    // The chat column settles a moment after load; place the button once it has
    setTimeout(clampFab, 1500);
    console.log(`[${MODULE}] loaded v1.10.0`);
}

(function bootstrap() {
    const { eventSource, event_types } = SillyTavern.getContext();
    // APP_READY fires immediately for late listeners if the app is already up
    eventSource.on(event_types.APP_READY, init);
})();
