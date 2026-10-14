const list = document.getElementById("episode-list");
const search = document.getElementById("episode-search");

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("nl-BE", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

// Toont eerst enkel de thumbnail; de YouTube-speler laadt pas na een klik.
function createVideo(ep) {
  const wrapper = document.createElement("div");
  wrapper.className = "episode-video";

  const button = document.createElement("button");
  button.setAttribute("aria-label", `Speel "${ep.title}" af`);

  const thumb = document.createElement("img");
  thumb.src = `https://i.ytimg.com/vi/${ep.youtube}/hqdefault.jpg`;
  thumb.alt = "";
  thumb.loading = "lazy";
  button.append(thumb);

  button.addEventListener("click", () => {
    // YouTube weigert in te sluiten zonder referrer (fout 153), wat altijd
    // het geval is bij een lokaal geopend bestand: open dan YouTube zelf.
    if (location.protocol === "file:") {
      window.open(`https://www.youtube.com/watch?v=${ep.youtube}`, "_blank", "noopener");
      return;
    }
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube-nocookie.com/embed/${ep.youtube}?autoplay=1`;
    iframe.title = ep.title;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    iframe.allowFullscreen = true;
    wrapper.replaceChildren(iframe);
  });

  wrapper.append(button);
  return wrapper;
}

function renderEpisodes(episodes) {
  list.replaceChildren();

  if (episodes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "episode-empty";
    empty.textContent = "Geen afleveringen gevonden.";
    list.append(empty);
    return;
  }

  for (const ep of episodes) {
    const article = document.createElement("article");
    article.className = "episode";

    const body = document.createElement("div");
    body.className = "episode-body";

    const meta = document.createElement("p");
    meta.className = "episode-meta";
    meta.textContent = `${ep.label} · ${formatDate(ep.date)}`;

    const title = document.createElement("h3");
    title.textContent = ep.title;

    const desc = document.createElement("p");
    desc.textContent = ep.description;

    body.append(meta, title, desc);
    if (ep.youtube) article.append(createVideo(ep));
    article.append(body);
    list.append(article);
  }
}

search.addEventListener("input", () => {
  const q = search.value.trim().toLowerCase();
  renderEpisodes(
    EPISODES.filter(
      (ep) =>
        ep.title.toLowerCase().includes(q) ||
        ep.description.toLowerCase().includes(q)
    )
  );
});

renderEpisodes(EPISODES);
