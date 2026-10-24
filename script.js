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
                return { group: entry.group, html, key: contentKey };
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
    let mediaKey = null;

    async function showEncrypted(img) {
        try {
            const buf = new Uint8Array(await (await fetch(img.dataset.enc)).arrayBuffer());
            const key = await crypto.subtle.importKey("raw", mediaKey, "AES-GCM", false, ["decrypt"]);
            const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.subarray(0, 12) }, key, buf.subarray(12));
            img.src = URL.createObjectURL(new Blob([plain], { type: "image/jpeg" }));
        } catch {}
    }

    function initEncryptedImages() {
        const imgs = document.querySelectorAll("img[data-enc]");
        if (!("IntersectionObserver" in window)) {
            imgs.forEach(showEncrypted);
            return;
        }
        const io = new IntersectionObserver(
            (entries) =>
                entries.forEach((e) => {
                    if (!e.isIntersecting) return;
                    io.unobserve(e.target);
                    showEncrypted(e.target);
                }),
            { rootMargin: "800px 0px" }
        );
        imgs.forEach((img) => io.observe(img));
    }

    function unlock(content, fromGate) {
        if (group) return;
        group = content.group;
        mediaKey = content.key;
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
        initEncryptedImages();
        initMenu();
        initModals();
        initGallery();
        initPages();
        initEggs();
    }

    function initGallery() {
        const items = [...document.querySelectorAll(".polaroid")];
        const box = $("#lightbox");
        if (!items.length || !box) return;
        const figure = box.querySelector(".lightbox-photo");
        const big = figure.querySelector("img");
        const caption = figure.querySelector("figcaption");
        const count = box.querySelector(".lightbox-count");
        let index = 0;
        big.draggable = false;

        const ready = async (img) => {
            if (!img.src.startsWith("blob:")) await showEncrypted(img);
            return img.src;
        };

        async function show(n, from) {
            index = (n + items.length) % items.length;
            const img = items[index].querySelector("img");
            caption.textContent = img.alt;
            count.textContent = `${index + 1} / ${items.length}`;
            big.alt = img.alt;
            big.src = await ready(img);
            figure.style.setProperty("--from", from || "0px");
            figure.classList.remove("swap");
            void figure.offsetWidth;
            figure.classList.add("swap");
            [index + 1, index - 1].forEach((k) => ready(items[(k + items.length) % items.length].querySelector("img")));
        }

        items.forEach((item, i) =>
            item.addEventListener("click", () => {
                box.showModal();
                show(i);
            })
        );
        box.querySelector(".lightbox-prev").addEventListener("click", () => show(index - 1, "-40px"));
        box.querySelector(".lightbox-next").addEventListener("click", () => show(index + 1, "40px"));
        box.addEventListener("click", (e) => {
            if (e.target === box || e.target.closest("[data-close]")) box.close();
        });
        document.addEventListener("keydown", (e) => {
            if (!box.open) return;
            if (e.key === "ArrowRight") show(index + 1, "40px");
            if (e.key === "ArrowLeft") show(index - 1, "-40px");
        });

        let start = null;
        figure.addEventListener("pointerdown", (e) => (start = e.clientX));
        figure.addEventListener("pointerup", (e) => {
            if (start === null) return;
            const dx = e.clientX - start;
            start = null;
            if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1), dx < 0 ? "40px" : "-40px");
        });
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
            egg("czas");
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

        const onScroll = () => {
            const limit = document.body.classList.contains("page-open") ? 80 : window.innerHeight * 0.5;
            const visible = window.scrollY > limit;
            if (!visible && menu.classList.contains("open")) setOpen(false);
            menu.classList.toggle("scrolled", visible);
        };
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

    const EGGS = ["waz", "czas", "dzwony", "lemoniada", "kolory", "memory"];
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
        if (msg) toast(isNew ? `${msg}  ·  niespodzianka ${foundEggs.length}/${EGGS.length}` : msg);
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

        $("#egg-snake").addEventListener("click", () => {
            egg("waz", "Ukryty wąż weselny odkryty!");
            openGame("Wąż weselny", "Zbieraj weselne smakołyki i nie zjedz własnego ogona. Na komputerze steruj strzałkami na klawiaturze, a na telefonie przesuwaj palcem po planszy albo używaj przycisków pod nią.", snakeGame);
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

    function snakeGame(stage) {
        const SIZE = 14;
        const TREATS = ["💐", "🎂", "💌", "🍋", "🍓", "💍", "🧁"];
        const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
        const ARROWS = { up: "▲", left: "◀", down: "▼", right: "▶" };
        const KEYS = {
            arrowup: "up", arrowdown: "down", arrowleft: "left", arrowright: "right",
            w: "up", s: "down", a: "left", d: "right",
        };
        const BEST_KEY = "wedding-best-snake";
        const BODY = "#b8314f";
        const HEAD = "#8f2039";

        const canvas = document.createElement("canvas");
        canvas.className = "snake";
        const ctx = canvas.getContext("2d");
        const status = document.createElement("p");
        status.className = "game-status";
        const pad = document.createElement("div");
        pad.className = "snake-pad";
        pad.innerHTML = Object.keys(ARROWS)
            .map((d) => `<button type="button" data-dir="${d}" aria-label="${d}">${ARROWS[d]}</button>`)
            .join("");
        const again = document.createElement("button");
        again.type = "button";
        again.className = "btn";
        again.textContent = "Zagraj jeszcze raz";
        again.hidden = true;
        stage.append(canvas, status, pad, again);

        let cell = 0;
        let snake, prev, dir, queue, treat, score, running, over, best, last, frame;

        function resize() {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = canvas.height = Math.round(canvas.clientWidth * dpr);
            cell = canvas.width / SIZE;
        }

        function placeTreat() {
            const free = [];
            for (let x = 0; x < SIZE; x++)
                for (let y = 0; y < SIZE; y++)
                    if (!snake.some((p) => p.x === x && p.y === y)) free.push({ x, y });
            const spot = free[Math.floor(Math.random() * free.length)];
            treat = { ...spot, icon: TREATS[Math.floor(Math.random() * TREATS.length)] };
        }

        function showStatus(prefix) {
            status.textContent = (prefix ? prefix + "  ·  " : "") + `Wynik: ${score}` + (best ? `  ·  Rekord: ${best}` : "");
        }

        function reset() {
            const mid = Math.floor(SIZE / 2);
            snake = [{ x: mid, y: mid }, { x: mid - 1, y: mid }, { x: mid - 2, y: mid }];
            prev = snake;
            dir = "right";
            queue = [];
            score = 0;
            running = false;
            over = false;
            best = readBest(BEST_KEY);
            again.hidden = true;
            placeTreat();
            showStatus("Wybierz kierunek, aby zacząć");
        }

        const speed = () => Math.max(75, 170 - score * 6);

        function turn(next) {
            if (over) return;
            const lastDir = queue.length ? queue[queue.length - 1] : dir;
            const [lx, ly] = DIRS[lastDir];
            const [nx, ny] = DIRS[next];
            if (next === lastDir || (lx + nx === 0 && ly + ny === 0)) return;
            if (queue.length < 2) queue.push(next);
            if (!running) {
                running = true;
                last = performance.now();
                showStatus();
            }
        }

        function step() {
            if (queue.length) dir = queue.shift();
            const [dx, dy] = DIRS[dir];
            const head = {
                x: (snake[0].x + dx + SIZE) % SIZE,
                y: (snake[0].y + dy + SIZE) % SIZE,
            };
            const eats = head.x === treat.x && head.y === treat.y;
            const body = eats ? snake : snake.slice(0, -1);
            if (body.some((p) => p.x === head.x && p.y === head.y)) return finish();
            prev = snake;
            snake = [head, ...body];
            if (eats) {
                score++;
                const r = canvas.getBoundingClientRect();
                burst(r.left + ((treat.x + 0.5) * r.width) / SIZE, r.top + ((treat.y + 0.5) * r.height) / SIZE, {
                    chars: ["♥", treat.icon],
                    count: 8,
                    spread: 50,
                });
                if (snake.length === SIZE * SIZE) return finish();
                placeTreat();
                showStatus();
            }
        }

        function finish() {
            over = true;
            running = false;
            prev = snake;
            const record = score > best;
            if (record) {
                best = score;
                saveBest(BEST_KEY, score);
            }
            status.textContent = `Koniec! Wynik: ${score}` + (record ? "  ·  Nowy rekord!" : best ? `  ·  Rekord: ${best}` : "");
            if (record) burst(...centerOf(canvas), { count: 30 });
            again.hidden = false;
        }

        const wrapDelta = (d) => (d > 1 ? d - SIZE : d < -1 ? d + SIZE : d);

        function points(t) {
            const lerp = (a, b) => ({ x: a.x + wrapDelta(b.x - a.x) * t, y: a.y + wrapDelta(b.y - a.y) * t });
            const pts = [lerp(prev[0], snake[0]), ...snake.slice(1).map((p) => ({ ...p }))];
            if (prev.length === snake.length) pts.push(lerp(prev[prev.length - 1], snake[snake.length - 1]));
            for (let i = 1; i < pts.length; i++) {
                pts[i].x = pts[i - 1].x + wrapDelta(pts[i].x - pts[i - 1].x);
                pts[i].y = pts[i - 1].y + wrapDelta(pts[i].y - pts[i - 1].y);
            }
            return pts;
        }

        function drawSnake(pts, ox, oy, now) {
            const at = (p) => [(p.x + 0.5 + ox) * cell, (p.y + 0.5 + oy) * cell];
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.strokeStyle = BODY;
            ctx.lineWidth = cell * 0.7;
            ctx.beginPath();
            ctx.moveTo(...at(pts[pts.length - 1]));
            pts.slice(0, -1).reverse().forEach((p) => ctx.lineTo(...at(p)));
            ctx.stroke();

            const [hx, hy] = at(pts[0]);
            const [dx, dy] = DIRS[dir];
            ctx.save();
            ctx.translate(hx, hy);
            ctx.rotate(Math.atan2(dy, dx));
            ctx.scale(cell, cell);

            if (!over && Math.sin(now / 160) > -0.2) {
                ctx.strokeStyle = "#d4143f";
                ctx.lineWidth = 0.08;
                ctx.beginPath();
                ctx.moveTo(0.5, 0);
                ctx.lineTo(0.8, 0);
                ctx.lineTo(0.92, -0.1);
                ctx.moveTo(0.8, 0);
                ctx.lineTo(0.92, 0.1);
                ctx.stroke();
            }

            ctx.fillStyle = HEAD;
            ctx.beginPath();
            ctx.ellipse(0.1, 0, 0.5, 0.43, 0, 0, Math.PI * 2);
            ctx.fill();

            [-1, 1].forEach((side) => {
                ctx.fillStyle = "#ffffff";
                ctx.beginPath();
                ctx.ellipse(0.2, side * 0.2, 0.13, 0.11, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#2b0711";
                ctx.beginPath();
                if (over) ctx.ellipse(0.22, side * 0.2, 0.09, 0.025, 0, 0, Math.PI * 2);
                else ctx.arc(0.25, side * 0.2, 0.06, 0, Math.PI * 2);
                ctx.fill();
            });

            ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
            [-1, 1].forEach((side) => {
                ctx.beginPath();
                ctx.arc(0.5, side * 0.08, 0.025, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.restore();
        }

        function draw(t, now) {
            if (!cell) return;
            ctx.fillStyle = "#ffb27a";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "#ffaa70";
            for (let x = 0; x < SIZE; x++)
                for (let y = 0; y < SIZE; y++)
                    if ((x + y) % 2) ctx.fillRect(x * cell, y * cell, cell, cell);

            const pulse = 1 + Math.sin(now / 220) * 0.06;
            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = `${cell * 0.78 * pulse}px sans-serif`;
            ctx.fillText(treat.icon, (treat.x + 0.5) * cell, (treat.y + 0.56) * cell);

            const pts = points(t);
            for (const ox of [-SIZE, 0, SIZE]) for (const oy of [-SIZE, 0, SIZE]) drawSnake(pts, ox, oy, now);
        }

        function loop(now) {
            if (running) {
                while (running && now - last >= speed()) {
                    last += speed();
                    step();
                }
            }
            const t = running ? Math.min(1, (now - last) / speed()) : 1;
            draw(t, now);
            frame = requestAnimationFrame(loop);
        }

        const onKey = (e) => {
            const d = KEYS[e.key.toLowerCase()];
            if (!d) return;
            e.preventDefault();
            turn(d);
        };

        let start = null;
        const onDown = (e) => {
            start = [e.clientX, e.clientY];
        };
        const onMove = (e) => {
            if (!start) return;
            const dx = e.clientX - start[0];
            const dy = e.clientY - start[1];
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
            turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
            start = [e.clientX, e.clientY];
        };
        const onUp = () => {
            start = null;
        };

        pad.addEventListener("click", (e) => {
            const b = e.target.closest("[data-dir]");
            if (b) turn(b.dataset.dir);
        });
        again.addEventListener("click", reset);
        canvas.addEventListener("pointerdown", onDown);
        canvas.addEventListener("pointermove", onMove);
        canvas.addEventListener("pointerup", onUp);
        canvas.addEventListener("pointercancel", onUp);
        document.addEventListener("keydown", onKey);
        window.addEventListener("resize", resize);

        reset();
        resize();
        frame = requestAnimationFrame(loop);

        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener("keydown", onKey);
            window.removeEventListener("resize", resize);
        };
    }

    function coverLoaded() {
        const img = new Image();
        img.src = window.matchMedia("(max-width: 700px)").matches ? "assets/invitation-m.jpg" : "assets/invitation.jpg";
        const timeout = new Promise((r) => setTimeout(r, 5000));
        return Promise.race([img.decode().catch(() => {}), timeout]);
    }

    (async () => {
        const cover = coverLoaded();
        const fromQr = new URLSearchParams(location.hash.slice(1)).get("k");
        let opened = false;
        if (fromQr) {
            history.replaceState(null, "", location.pathname + location.search);
            opened = await tryPassword(fromQr, true);
        }
        if (!opened) {
            const saved = readSession();
            const content = saved && (await openContent(saved).catch(() => null));
            if (content) unlock(content, false);
        }
        await cover;
        document.body.classList.add("ready");
    })();

    window.addEventListener("hashchange", () => {
        if (location.hash.startsWith("#k=")) location.reload();
    });
})();
