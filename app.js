import { estimate, example, normalize } from "./core.js";
const $ = (id) => document.getElementById(id),
  fields = [
    "q",
    "r",
    "gate",
    "position",
    "velocity",
    "positionVariance",
    "velocityVariance",
  ];
let result,
  index = 40,
  history = [],
  dirty = false,
  plotScale = null;
function el(tag, attrs = {}, text) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}
const fmt = (x) => (x === null ? "—" : Number(x).toFixed(3));
function controls() {
  for (const id of ["export", "svg"]) $(id).disabled = dirty;
  $("undo").disabled = !history.length;
  $("previous").disabled = index === 0;
  $("next").disabled = index === result.rows.length - 1;
}
let drawnResult, drawnDimension, drawnBand, plotX, plotY;
function cursor() {
  const selected = result.rows[index],
    d = Number($("dimension").value);
  $("chart").querySelector(".cursor").style.transform =
    `translateX(${plotX(selected.t)}px)`;
  for (const method of ["filtered", "smoothed"])
    $("chart").querySelector(`.marker-${method}`).style.transform =
      `translate(${plotX(selected.t)}px, ${plotY(selected[method][d])}px)`;
}
function draw() {
  const dimension = Number($("dimension").value),
    band = $("band").value,
    rows = result.rows,
    svg = $("chart");
  if (
    drawnResult === result &&
    drawnDimension === dimension &&
    drawnBand === band
  ) {
    cursor();
    return;
  }
  drawnResult = result;
  drawnDimension = dimension;
  drawnBand = band;
  svg.replaceChildren();
  const values = [];
  for (const r of rows) {
    values.push(r.filtered[dimension], r.smoothed[dimension]);
    if (r.truth) values.push(r.truth[dimension]);
    if (dimension === 0 && r.z !== null) values.push(r.z);
    if (band !== "none") {
      const spread =
        1.96 * Math.sqrt(r[band + "Covariance"][dimension ? 3 : 0]);
      values.push(r[band][dimension] - spread, r[band][dimension] + spread);
    }
  }
  let lo = Math.min(...values),
    hi = Math.max(...values),
    pad = Math.max(1e-3, (hi - lo) * 0.1);
  lo -= pad;
  hi += pad;
  const start = rows[0].t,
    end = rows.at(-1).t,
    X = (t) => 75 + ((t - start) / (end - start)) * 885,
    Y = (v) => 455 - ((v - lo) / (hi - lo)) * 420;
  plotScale = { start, end };
  plotX = X;
  plotY = Y;
  for (let i = 0; i <= 5; i++) {
    const y = 35 + i * 84,
      value = hi - ((hi - lo) * i) / 5;
    svg.append(el("line", { x1: 75, y1: y, x2: 960, y2: y, class: "grid" }));
    svg.append(
      el(
        "text",
        { x: 64, y: y + 4, "text-anchor": "end" },
        Math.abs(value) > 10000 ? value.toExponential(1) : value.toFixed(1),
      ),
    );
    const t = start + ((end - start) * i) / 5,
      x = X(t);
    svg.append(
      el("text", { x, y: 482, "text-anchor": "middle" }, t.toFixed(1)),
    );
  }
  svg.append(el("text", { x: 960, y: 510, "text-anchor": "end" }, "time"));
  const path = (points) =>
    points.map((p, i) => (i ? "L" : "M") + p.join(" ")).join(" ");
  if (band !== "none") {
    const top = rows.map((r) => [
        X(r.t),
        Y(
          r[band][dimension] +
            1.96 * Math.sqrt(r[band + "Covariance"][dimension ? 3 : 0]),
        ),
      ]),
      bottom = rows
        .toReversed()
        .map((r) => [
          X(r.t),
          Y(
            r[band][dimension] -
              1.96 * Math.sqrt(r[band + "Covariance"][dimension ? 3 : 0]),
          ),
        ]);
    svg.append(
      el("path", {
        d: path([...top, ...bottom]) + "Z",
        class: "band",
        fill: band === "filtered" ? "#4c748d20" : "#be81551b",
      }),
    );
  }
  let truthPath = "";
  rows.forEach((r, i) => {
    if (r.truth)
      truthPath +=
        (i && rows[i - 1].truth ? "L" : "M") +
        `${X(r.t)} ${Y(r.truth[dimension])} `;
  });
  if (truthPath) svg.append(el("path", { d: truthPath, class: "truth" }));
  for (const method of ["filtered", "smoothed"])
    svg.append(
      el("path", {
        d: path(rows.map((r) => [X(r.t), Y(r[method][dimension])])),
        class: method,
      }),
    );
  if (dimension === 0)
    for (const r of rows)
      if (r.z !== null) {
        const x = X(r.t),
          y = Y(r.z);
        svg.append(
          r.status === "gated"
            ? el("path", {
                d: `M${x - 4} ${y - 4}L${x + 4} ${y + 4}M${x - 4} ${y + 4}L${x + 4} ${y - 4}`,
                class: "gated",
              })
            : el("circle", { cx: x, cy: y, r: 2.6, class: "observation" }),
        );
      }
  svg.append(el("line", { x1: 0, x2: 0, y1: 30, y2: 460, class: "cursor" }));
  for (const method of ["filtered", "smoothed"])
    svg.append(
      el("circle", {
        cx: 0,
        cy: 0,
        r: 5,
        class: `marker-${method}`,
        fill: method === "filtered" ? "#4c748d" : "#be8155",
        stroke: "#fff",
        "stroke-width": 2,
      }),
    );
  cursor();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (const curve of svg.querySelectorAll("path.filtered, path.smoothed")) {
      const length = curve.getTotalLength();
      curve.animate(
        [
          { strokeDasharray: `${length} ${length}`, strokeDashoffset: length },
          { strokeDasharray: `${length} ${length}`, strokeDashoffset: 0 },
        ],
        { duration: 650, easing: "ease-out" },
      );
    }
  }
}
function inspect() {
  const r = result.rows[index],
    d = Number($("dimension").value);
  $("step").max = result.rows.length - 1;
  $("step").value = index;
  $("step-label").textContent = `${index + 1} / ${result.rows.length}`;
  $("time").textContent = "t = " + r.t.toFixed(2);
  $("classification").textContent = r.status.toUpperCase();
  $("detail").replaceChildren(
    ...[
      ["Filtered", fmt(r.filtered[d])],
      ["Smoothed", fmt(r.smoothed[d])],
      ["Reference truth", r.truth ? fmt(r.truth[d]) : "—"],
      ["Innovation", fmt(r.innovation)],
      ["Innovation variance", fmt(r.innovationVariance)],
      ["NIS", fmt(r.nis)],
      ["Position gain", fmt(r.gain[0])],
      ["Velocity gain", fmt(r.gain[1])],
    ].map(([label, value]) => {
      const div = document.createElement("div"),
        dt = document.createElement("dt"),
        dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      div.append(dt, dd);
      return div;
    }),
  );
  $("measurement").value = r.z ?? "";
  $("missing").checked = r.z === null;
  $("measurement").disabled = r.z === null;
  controls();
  draw();
}
function render() {
  const m = result.metrics;
  $("counts").textContent = `${m.accepted} / ${m.gated} / ${m.missing}`;
  $("filter-score").textContent = fmt(m.filtered.positionRmse);
  $("smooth-score").textContent = fmt(m.smoothed.positionRmse);
  $("nis").textContent = fmt(m.meanNis);
  $("coverage").textContent = m.truthCount
    ? `Reference truth supplied for ${m.truthCount} rows. Position within model ±1.96σ: filtered ${m.filtered.positionCovered}/${m.truthCount}; smoothed ${m.smoothed.positionCovered}/${m.truthCount}. Gating can change calibration.`
    : "No reference truth supplied. RMSE and empirical coverage are unavailable.";
  inspect();
}
function apply(study, remember = true) {
  const next = estimate(study);
  if (remember && result) {
    history.push(result.study);
    if (history.length > 20) history.shift();
  }
  result = next;
  dirty = false;
  index = Math.min(index, result.rows.length - 1);
  for (const f of fields) $(f).value = result.study.options[f];
  $("observations").value = JSON.stringify(result.study.observations, null, 2);
  $("error").textContent = "";
  $("status").textContent =
    "Filtered forward, smoothed backward. All covariance matrices passed positivity checks.";
  render();
}
function draft() {
  if ($("observations").value.length > 200000)
    throw Error("Observation JSON must be at most 200 KB.");
  return normalize({
    options: Object.fromEntries(fields.map((f) => [f, Number($(f).value)])),
    observations: JSON.parse($("observations").value),
  });
}
function attempt(fn) {
  try {
    fn();
    $("error").textContent = "";
  } catch (e) {
    $("error").textContent = e.message;
  }
}
$("settings-form").onsubmit = (e) => {
  e.preventDefault();
  attempt(() => apply(draft()));
};
for (const id of [...fields, "observations"])
  $(id).oninput = () => {
    dirty = true;
    $("status").textContent =
      "Model draft · estimate again to refresh results and exports.";
    controls();
  };
$("example").onclick = () =>
  attempt(() => {
    index = 40;
    apply(example());
  });
$("undo").onclick = () =>
  attempt(() => {
    if (history.length) {
      apply(history.at(-1), false);
      history.pop();
      controls();
    }
  });
$("missing").onchange = () => {
  $("measurement").disabled = $("missing").checked;
};
$("edit-point").onsubmit = (e) => {
  e.preventDefault();
  attempt(() => {
    if (dirty) throw Error("Apply the model draft before editing a reading.");
    const s = structuredClone(result.study);
    if (!$("missing").checked && $("measurement").value === "")
      throw Error("Enter a reading or mark it missing.");
    s.observations[index].z = $("missing").checked
      ? null
      : Number($("measurement").value);
    apply(s);
  });
};
function jump(i) {
  index = Math.max(0, Math.min(result.rows.length - 1, i));
  inspect();
}
$("step").oninput = () => jump(Number($("step").value));
$("previous").onclick = () => jump(index - 1);
$("next").onclick = () => jump(index + 1);
$("dimension").onchange = inspect;
$("band").onchange = draw;
$("chart").onkeydown = (e) => {
  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
    e.preventDefault();
    jump(
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? result.rows.length - 1
          : index + (e.key === "ArrowRight" ? 1 : -1),
    );
  }
};
$("chart").onclick = (e) => {
  const box = e.currentTarget.getBoundingClientRect(),
    x = ((e.clientX - box.left) / box.width) * 1000,
    t = plotScale.start + ((x - 75) / 885) * (plotScale.end - plotScale.start);
  let best = 0;
  result.rows.forEach((r, i) => {
    if (Math.abs(r.t - t) < Math.abs(result.rows[best].t - t)) best = i;
  });
  jump(best);
};
function download(name, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("export").onclick = () =>
  download(
    "motion-margin-evidence.json",
    JSON.stringify(
      { format: "motion-margin-evidence-v1", ...result, inspectedIndex: index },
      null,
      2,
    ),
  );
$("save").onclick = () =>
  attempt(() =>
    download("motion-margin-study.json", JSON.stringify(draft(), null, 2)),
  );
$("svg").onclick = () => {
  const clone = $("chart").cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const style = el(
    "style",
    {},
    "text{font:11px Arial;fill:#71838b}.grid{stroke:#e2e7e4}.filtered{stroke:#4c748d;fill:none;stroke-width:2}.smoothed{stroke:#be8155;fill:none;stroke-width:2}.truth{stroke:#92a496;fill:none;stroke-dasharray:5 5}.observation{fill:white;stroke:#aeb9bb}.gated{stroke:#b56150;stroke-width:2;fill:none}.band{stroke:none}.cursor{stroke:#8f9c9f;stroke-dasharray:3 4}",
  );
  clone.prepend(style);
  download(
    "motion-margin-chart.svg",
    new XMLSerializer().serializeToString(clone),
    "image/svg+xml",
  );
};
$("open").onclick = () => $("file").click();
$("file").onchange = async () => {
  const f = $("file").files[0];
  $("file").value = "";
  if (!f) return;
  try {
    if (f.size > 200000) throw Error("Studies must be at most 200 KB.");
    apply(JSON.parse(await f.text()));
  } catch (e) {
    $("error").textContent = e.message;
  }
};
apply(example(), false);
