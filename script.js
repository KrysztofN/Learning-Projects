(() => {
    const LOCAL = ["localhost", "127.0.0.1", ""].includes(location.hostname);
    if (location.protocol === "http:" && !LOCAL) {
        location.replace("https://" + location.host + location.pathname + location.search + location.hash);
        return;
    }

    const WEDDING = new Date("2027-08-19T15:00:00+02:00");
    const RSVP_DEADLINE = new Date("2027-07-01T23:59:59+02:00");
    const TZ = "+02:00";
    const STORAGE_KEY = "wedding-key";

    const $ = (sel) => document.querySelector(sel);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;


    let toastTimer;
    function toast(msg) {
        const el = $("#toast");
        el.textContent = msg;
        el.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
    }

    function normalizePassword(s) {
        return s
            .replace(/ł/g, "l")
            .replace(/Ł/g, "L")
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
    }

    const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const toBase64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

    async function passwordKey(password) {
        const { salt, iterations } = window.ACCESS;
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey("raw", enc.encode(normalizePassword(password)), "PBKDF2", false, ["deriveBits"]);
        return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations }, key, 256);
    }

    async function decrypt(rawKey, { iv, data }) {
        const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, key, fromBase64(data));
    }

    async function openContent(rawKey) {
        for (const entry of window.ACCESS.keys) {
            try {
                const contentKey = await decrypt(rawKey, entry);
                const html = new TextDecoder().decode(await decrypt(contentKey, window.ACCESS));
                return { group: entry.group, html };
            } catch {}
        }
        return null;
    }

    function readSession() {
        try {
            const key = localStorage.getItem(STORAGE_KEY);
            if (key) return fromBase64(key);
        } catch {}
        return null;
    }

    function saveSession(rawKey) {
        try { localStorage.setItem(STORAGE_KEY, toBase64(rawKey)); } catch {}
    }

    let group = null;

    function unlock(content, fromGate) {
        if (group) return;
        group = content.group;
        const tpl = document.createElement("template");
        tpl.innerHTML = content.html;
        $("#app").replaceWith(tpl.content);
        document.body.classList.add("group-" + group);
        if (fromGate) document.body.style.setProperty("--hero-delay", "0.3s");
        document.body.classList.remove("locked");
        document.body.classList.add("unlocked");
        initPage();
    }

    const gateForm = $("#gate-form");
    const gateInput = $("#gate-password");
    const gateError = $("#gate-error");
    const gateSubmit = $("#gate-submit");

    async function tryPassword(password, fromQr) {
        gateError.textContent = "";
        gateSubmit.disabled = true;
        gateSubmit.textContent = "Sprawdzam…";
        try {
            const rawKey = await passwordKey(password);
            const content = await openContent(rawKey);
            if (content) {
                saveSession(rawKey);
                if (fromQr) {
                    unlock(content, false);
                } else {
                    document.body.classList.add("gate-out");
                    setTimeout(() => unlock(content, true), reducedMotion ? 0 : 500);
                }
                return true;
            }
            gateError.textContent = "Nieprawidłowe hasło. Sprawdź zaproszenie albo napisz do nas!";
            gateForm.classList.remove("shake");
            void gateForm.offsetWidth;
            gateForm.classList.add("shake");
        } catch {
            gateError.textContent = "Twoja przeglądarka nie obsługuje weryfikacji. Spróbuj w innej przeglądarce.";
        }
        gateSubmit.disabled = false;
        gateSubmit.textContent = "Otwórz zaproszenie";
        return false;
    }

    gateForm.addEventListener("submit", (e) => {
        e.preventDefault();
        if (normalizePassword(gateInput.value).length === 0) {
            gateError.textContent = "Wpisz proszę hasło.";
            return;
        }
        tryPassword(gateInput.value, false);
    });

    let initialized = false;
    function initPage() {
        if (initialized) return;
        initialized = true;
        startCountdown();
        markTimeline();
        setInterval(markTimeline, 60000);
        initRsvp();
        initCalendar();
        initReveal();
        initMenu();
        initCopy();
        initModals();
        initPages();
        initEggs();
    }

    function initModals() {
        document.querySelectorAll("[data-spot]").forEach((tile) =>
            tile.addEventListener("click", () => document.getElementById(tile.dataset.spot).showModal())
        );
        document.querySelectorAll("dialog.modal").forEach((modal) => {
            modal.addEventListener("click", (e) => {
                if (e.target === modal || e.target.closest("[data-close]")) modal.close();
            });
        });
    }

    let returnTo = null;
    let openedFromSite = false;

    function route() {
        const [, id] = location.hash.match(/^#\/([\w-]+)/) || [];
        const page = id ? document.getElementById("p-" + id) : null;
        document.querySelectorAll(".page").forEach((p) => (p.hidden = p !== page));
        $("main").hidden = !!page;
        document.body.classList.toggle("page-open", !!page);
        if (page) {
            window.scrollTo({ top: 0, behavior: "instant" });
        } else {
            openedFromSite = false;
            if (returnTo) returnTo.scrollIntoView({ behavior: "instant", block: "start" });
            returnTo = null;
        }
    }

    function closePage() {
        if (!document.body.classList.contains("page-open")) return;
        returnTo = null;
        history.replaceState(null, "", location.pathname);
        route();
    }

    function initPages() {
        document.addEventListener("click", (e) => {
            const link = e.target.closest('a[href^="#/"]');
            if (link) {
                returnTo = link.closest("section");
                openedFromSite = true;
                return;
            }
            if (!e.target.closest("[data-back]")) return;
            if (openedFromSite) {
                history.back();
            } else {
                history.replaceState(null, "", location.pathname);
                route();
            }
        });
        window.addEventListener("hashchange", route);
        route();
    }

    function plural(n, [one, few, many]) {
        if (n === 1) return one;
        const d = n % 10;
        const t = n % 100;
        return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
    }

    const COUNTDOWN_UNITS = [
        { ms: 86400000, forms: ["dzień", "dni", "dni"] },
        { ms: 3600000, forms: ["godzina", "godziny", "godzin"] },
        { ms: 60000 / 72, forms: ["uderzenie serca", "uderzenia serca", "uderzeń serca"] },
    ];
    let unitIndex = 0;

    function startCountdown() {
        const countdown = $("#countdown");
        const value = $("#cd-value");
        const unit = $("#cd-unit");

        function tick() {
            const diff = WEDDING - Date.now();
            if (diff <= 0) {
                countdown.classList.add("done");
                countdown.innerHTML = '<span class="cd-label">19.08.2027</span><span class="cd-done">Powiedzieliśmy sobie „tak”!</span>';
                clearInterval(timer);
                return;
            }
            const u = COUNTDOWN_UNITS[unitIndex];
            const n = Math.floor(diff / u.ms);
            value.textContent = n.toLocaleString("pl-PL");
            value.classList.toggle("long", value.textContent.length > 6);
            unit.textContent = plural(n, u.forms);
        }

        countdown.addEventListener("click", () => {
            if (countdown.classList.contains("done")) return;
            unitIndex = (unitIndex + 1) % COUNTDOWN_UNITS.length;
            countdown.classList.remove("pop");
            void countdown.offsetWidth;
            countdown.classList.add("pop");
            tick();
            egg("czas", `Odliczamy w: ${COUNTDOWN_UNITS[unitIndex].forms[2]}`);
        });

        const timer = setInterval(tick, 1000);
        tick();
    }

    function markTimeline() {
        const items = [...document.querySelectorAll(".timeline li[data-at]")].filter((li) => {
            const g = li.closest("[data-group]");
            return !g || g.dataset.group === group;
        });
        const now = Date.now();
        let current = null;
        items.forEach((li) => {
            li.classList.remove("past", "now");
            if (new Date(li.dataset.at + ":00" + TZ).getTime() <= now) current = li;
        });
        if (!current) return;
        items.slice(0, items.indexOf(current)).forEach((li) => li.classList.add("past"));
        if (now < new Date("2027-08-20T14:00:00" + TZ).getTime()) current.classList.add("now");
        else current.classList.add("past");
    }

    function initRsvp() {
        const daysToRsvp = Math.ceil((RSVP_DEADLINE - Date.now()) / 86400000);
        if (daysToRsvp > 0) {
            $("#rsvp-left").textContent = daysToRsvp === 1 ? "Został ostatni dzień!" : `Zostało ${daysToRsvp} dni`;
        }
    }

    function initCalendar() {
        const { address: ADDRESS, events } = JSON.parse($("#event-data").textContent);
        const ev = { title: "Ślub Mileny i Krzysztofa", ...events[group] };

        $("#add-gcal").href =
            "https://calendar.google.com/calendar/render?action=TEMPLATE" +
            `&text=${encodeURIComponent(ev.title)}` +
            `&dates=${ev.start}/${ev.end}` +
            `&details=${encodeURIComponent(ev.details)}` +
            `&location=${encodeURIComponent(ADDRESS)}`;

        $("#add-ics").addEventListener("click", () => {
            const esc = (t) => t.replace(/[\\,;]/g, "\\$&").replace(/\n/g, "\\n");
            const ics = [
                "BEGIN:VCALENDAR",
                "VERSION:2.0",
                "PRODID:-//Milena & Krzysztof//Wedding//PL",
                "BEGIN:VEVENT",
                "UID:wedding-20270819@19-08-2027.pl",
                "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z",
                "DTSTART:" + ev.start,
                "DTEND:" + ev.end,
                "SUMMARY:" + esc(ev.title),
                "DESCRIPTION:" + esc(ev.details),
                "LOCATION:" + esc(ADDRESS),
                "BEGIN:VALARM",
                "TRIGGER:-P7D",
                "ACTION:DISPLAY",
                "DESCRIPTION:Za tydzień ślub Mileny i Krzysztofa!",
                "END:VALARM",
                "END:VEVENT",
                "END:VCALENDAR",
            ].join("\r\n");

            const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = "slub-milena-krzysztof.ics";
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
    }

    function initCopy() {
        document.querySelectorAll("[data-copy]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                try {
                    await navigator.clipboard.writeText(btn.dataset.copy);
                    toast("Adres skopiowany ♥");
                } catch {
                    toast(btn.dataset.copy);
                }
            });
        });
    }

    function initReveal() {
        const reveals = document.querySelectorAll(".reveal");
        if (!("IntersectionObserver" in window) || reducedMotion) {
            reveals.forEach((el) => el.classList.add("in"));
            return;
        }
        const io = new IntersectionObserver(
            (entries) => {
                entries.forEach((e) => {
                    if (e.isIntersecting) {
                        e.target.classList.add("in");
                        io.unobserve(e.target);
                    }
                });
            },
            { threshold: 0.2 }
        );
        reveals.forEach((el) => io.observe(el));
    }

    function initMenu() {
        const menu = $("#menu");
        const toggle = $("#menu-toggle");
        const links = [...menu.querySelectorAll(".menu-links a")];

        const setOpen = (open) => {
            menu.classList.toggle("open", open);
            toggle.setAttribute("aria-expanded", open);
            toggle.setAttribute("aria-label", open ? "Zamknij menu" : "Otwórz menu");
        };
        toggle.addEventListener("click", () => setOpen(!menu.classList.contains("open")));

        document.querySelectorAll('a[href^="#"]:not([href^="#/"])').forEach((a) =>
            a.addEventListener("click", (e) => {
                setOpen(false);
                const target = document.querySelector(a.hash);
                if (!target) return;
                e.preventDefault();
                closePage();
                target.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
                target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
                history.replaceState(null, "", a.hash === "#top" ? location.pathname : a.hash);
            })
        );
        document.addEventListener("keydown", (e) => e.key === "Escape" && setOpen(false));

        const onScroll = () => menu.classList.toggle("scrolled", window.scrollY > 40);
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();

        if (!("IntersectionObserver" in window)) return;
        const byId = Object.fromEntries(links.map((a) => [a.hash.slice(1), a]));
        const spy = new IntersectionObserver(
            (entries) => {
                entries.forEach((e) => {
                    if (!e.isIntersecting) return;
                    links.forEach((a) => a.classList.remove("active"));
                    byId[e.target.id]?.classList.add("active");
                });
            },
            { rootMargin: "-45% 0px -50% 0px" }
        );
        Object.keys(byId).forEach((id) => spy.observe(document.getElementById(id)));
    }

    if (!reducedMotion) {
        const box = $(".sparkles");
        const count = window.innerWidth < 600 ? 14 : 26;
        for (let i = 0; i < count; i++) {
            const p = document.createElement("i");
            p.style.left = Math.random() * 100 + "%";
            p.style.setProperty("--s", 4 + Math.random() * 8 + "px");
            p.style.setProperty("--d", 12 + Math.random() * 14 + "s");
            p.style.setProperty("--delay", -Math.random() * 20 + "s");
            p.style.setProperty("--x", (Math.random() - 0.5) * 160 + "px");
            box.appendChild(p);
        }
    }

    const EGGS = ["serca", "czas", "dzwony", "lemoniada", "kolory", "memory"];
    const EGGS_KEY = "wedding-eggs";

    function loadEggs() {
        try {
            const list = JSON.parse(localStorage.getItem(EGGS_KEY));
            return Array.isArray(list) ? list.filter((e) => EGGS.includes(e)) : [];
        } catch {
            return [];
        }
    }

    let foundEggs = loadEggs();

    function renderEggs() {
        $("#eggs-found").textContent = foundEggs.length;
        $("#eggs-total").textContent = EGGS.length;
    }

    function egg(id, msg) {
        const isNew = !foundEggs.includes(id);
        if (isNew) {
            foundEggs.push(id);
            try { localStorage.setItem(EGGS_KEY, JSON.stringify(foundEggs)); } catch {}
            renderEggs();
        }
        if (isNew && foundEggs.length === EGGS.length) {
            toast("Wszystkie niespodzianki znalezione! Jesteście niesamowici 🏆");
            celebrate();
            return;
        }
        toast(isNew ? `${msg}  ·  niespodzianka ${foundEggs.length}/${EGGS.length}` : msg);
    }

    const colors = ["#fff", "#ffd08a", "#e8456f", "#ff8c3a", "#ffb3c1"];

    function burst(x, y, { chars = ["♥"], palette = colors, count = 24, spread = 180 } = {}) {
        for (let i = 0; i < count; i++) {
            const h = document.createElement("span");
            h.className = "heart";
            h.textContent = chars[i % chars.length];
            const angle = Math.random() * Math.PI * 2;
            const dist = 60 + Math.random() * spread;
            h.style.left = x + "px";
            h.style.top = y + "px";
            h.style.setProperty("--dx", Math.cos(angle) * dist + "px");
            h.style.setProperty("--dy", Math.sin(angle) * dist - 60 + "px");
            h.style.setProperty("--rot", (Math.random() - 0.5) * 120 + "deg");
            h.style.setProperty("--size", 14 + Math.random() * 18 + "px");
            h.style.setProperty("--color", palette[i % palette.length]);
            document.body.appendChild(h);
            h.addEventListener("animationend", () => h.remove());
        }
    }

    const centerOf = (el) => {
        const r = el.getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
    };

    function celebrate() {
        for (let i = 0; i < 6; i++) {
            setTimeout(() => {
                burst(innerWidth * (0.15 + Math.random() * 0.7), innerHeight * (0.2 + Math.random() * 0.5), {
                    chars: ["♥", "✦", "❀"],
                    count: 28,
                    spread: 220,
                });
            }, i * 260);
        }
    }

    let typed = "";
    document.addEventListener("keydown", (e) => {
        if (e.target.closest?.("input, textarea") || e.key.length !== 1) return;
        typed = (typed + e.key.toLowerCase()).slice(-3);
        if (typed === "tak") sayYes();
    });

    function sayYes() {
        if (document.body.classList.contains("locked")) return;
        celebrate();
        toast("TAK! TAK! TAK! 💍");
    }

    let audio = null;
    function chime() {
        try {
            audio = audio || new (window.AudioContext || window.webkitAudioContext)();
            const now = audio.currentTime;
            [1318.5, 1046.5, 1174.7, 784].forEach((freq, i) => {
                const t = now + i * 0.32;
                [1, 2.76].forEach((mult, k) => {
                    const osc = audio.createOscillator();
                    const gain = audio.createGain();
                    osc.type = "sine";
                    osc.frequency.value = freq * mult;
                    gain.gain.setValueAtTime(0.0001, t);
                    gain.gain.exponentialRampToValueAtTime(k ? 0.03 : 0.12, t + 0.01);
                    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
                    osc.connect(gain).connect(audio.destination);
                    osc.start(t);
                    osc.stop(t + 1.7);
                });
            });
        } catch {}
    }

    const game = $("#game");
    const gameStage = $("#game-stage");
    let gameCleanup = null;

    function openGame(title, info, setup) {
        closeGame();
        $("#game-title").textContent = title;
        $("#game-info").textContent = info;
        gameStage.replaceChildren();
        game.hidden = false;
        document.body.classList.add("game-open");
        gameCleanup = setup(gameStage) || null;
        $("#game-close").focus();
    }

    function closeGame() {
        if (gameCleanup) gameCleanup();
        gameCleanup = null;
        game.hidden = true;
        document.body.classList.remove("game-open");
    }

    $("#game-close").addEventListener("click", closeGame);
    game.addEventListener("click", (e) => e.target === game && closeGame());
    document.addEventListener("keydown", (e) => e.key === "Escape" && !game.hidden && closeGame());

    const readBest = (key) => {
        try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
    };
    const saveBest = (key, v) => {
        try { localStorage.setItem(key, String(v)); } catch {}
    };

    function initEggs() {
        renderEggs();

        $(".amp").addEventListener("click", (e) => {
            burst(...centerOf(e.currentTarget));
            egg("serca", "Miłość wisi w powietrzu ♥");
        });

        $("#egg-bells").addEventListener("click", (e) => {
            chime();
            const bells = e.currentTarget;
            bells.classList.remove("ring");
            void bells.offsetWidth;
            bells.classList.add("ring");
            burst(...centerOf(bells), { chars: ["🔔", "💍", "♥"], count: 20, spread: 160 });
            egg("dzwony", "Ding dong! Dokładnie wtedy powiemy sobie „tak” 💍");
        });

        $("#egg-glass").addEventListener("click", (e) => {
            burst(...centerOf(e.currentTarget), { chars: ["🍋", "🍓", "🧃", "○"], count: 18, spread: 140 });
            egg("lemoniada", "Za to lemoniada poleje się strumieniami! 🍋");
        });

        document.querySelectorAll(".palette span").forEach((sw) => {
            sw.addEventListener("click", () => {
                const card = sw.closest(".card");
                if (sw.closest(".palette-no")) {
                    card.classList.remove("shake");
                    void card.offsetWidth;
                    card.classList.add("shake");
                    egg("kolory", "Ten kolor zostawiamy w szafie 😉");
                    return;
                }
                const c = sw.style.getPropertyValue("--c");
                document.body.style.setProperty("--sparkle", c);
                burst(...centerOf(sw), { chars: ["●", "✦"], palette: [c, "#fff"], count: 16, spread: 110 });
                egg("kolory", `${sw.title} - świetny wybór!`);
            });
        });

        $("#egg-memory").addEventListener("click", () => {
            egg("memory", "Ukryta gra w pary odkryta!");
            openGame("Memory weselne", "Znajdź wszystkie pary w jak najmniejszej liczbie ruchów.", memoryGame);
        });
    }

    function memoryGame(stage) {
        const icons = ["💍", "💐", "🎂", "💌", "🕊️", "🍋"];
        const deck = [...icons, ...icons].sort(() => Math.random() - 0.5);
        const best = readBest("wedding-best-memory");
        const status = document.createElement("p");
        status.className = "game-status";
        const grid = document.createElement("div");
        grid.className = "memory";
        stage.append(grid, status);

        let open = [];
        let moves = 0;
        let pairs = 0;
        const update = () => {
            status.textContent = `Ruchy: ${moves}` + (best ? `  ·  Rekord: ${best}` : "");
        };
        update();

        deck.forEach((icon) => {
            const card = document.createElement("button");
            card.type = "button";
            card.className = "memory-card";
            card.dataset.icon = icon;
            card.innerHTML = `<span class="memory-back">♥</span><span class="memory-front">${icon}</span>`;
            card.addEventListener("click", () => {
                if (open.length === 2 || card.classList.contains("flipped")) return;
                card.classList.add("flipped");
                open.push(card);
                if (open.length < 2) return;
                moves++;
                update();
                const [a, b] = open;
                if (a.dataset.icon === b.dataset.icon) {
                    a.classList.add("matched");
                    b.classList.add("matched");
                    open = [];
                    pairs++;
                    if (pairs === icons.length) {
                        const record = !best || moves < best;
                        if (record) saveBest("wedding-best-memory", moves);
                        status.textContent = `Brawo! ${moves} ruchów${record ? " - nowy rekord!" : ""}`;
                        burst(...centerOf(grid), { count: 30 });
                    }
                } else {
                    setTimeout(() => {
                        a.classList.remove("flipped");
                        b.classList.remove("flipped");
                        open = [];
                    }, 750);
                }
            });
            grid.appendChild(card);
        });
    }

    (async () => {
        const fromQr = new URLSearchParams(location.hash.slice(1)).get("k");
        if (fromQr) {
            history.replaceState(null, "", location.pathname + location.search);
            if (await tryPassword(fromQr, true)) return;
        }
        const saved = readSession();
        const content = saved && (await openContent(saved).catch(() => null));
        if (content) unlock(content, false);
    })();

    window.addEventListener("hashchange", () => {
        if (location.hash.startsWith("#k=")) location.reload();
    });
})();
