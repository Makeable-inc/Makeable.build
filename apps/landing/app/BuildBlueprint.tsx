// Folded three-panel blueprint shown beside "Make your own build".
// Drawn as SVG rather than a bitmap so every label stays crisp and editable.
// Deliberately plain: heading, one line of copy, one drawing per panel.
const BLUE = "#0c4e9c"; // --mk-blue, the brand cobalt (not --ink, which is navy)
const INK = "#12161a";
const PAPER = "#f8f4ec"; // sheet tone, used to occlude where solids overlap

// Registration mark: a dotted cross sitting on the fold line — four equally
// heavy arms broken at the centre, the vertical pair a little longer than the
// horizontal so the mark reads upright rather than square.
function Mark({ x, y }: { x: number; y: number }) {
  return (
    <g stroke={BLUE} strokeWidth="3.2" strokeLinecap="butt">
      <path d={`M${x} ${y - 12}v10.5M${x} ${y + 1.5}v10.5`} />
      <path d={`M${x - 9} ${y}h7.5M${x + 1.5} ${y}h7.5`} />
    </g>
  );
}

function Heading({ x, n, children }: { x: number; n: string; children: string }) {
  return (
    <text x={x} y={130} fill={BLUE} fontSize="26" fontWeight="700">
      <tspan>{n}</tspan>
      <tspan dx="14">{children}</tspan>
    </text>
  );
}

export default function BuildBlueprint() {
  return (
    <svg
      className="blueprint"
      viewBox="0 0 1400 552"
      role="img"
      aria-label="Three-panel Makeable blueprint: describe your idea, we prepare the kit parts, then publish and share the finished build"
    >
      <defs>
        <pattern id="bp-grid" width="15" height="15" patternUnits="userSpaceOnUse">
          <path d="M15 0H0v15" fill="none" stroke="#b6c7e3" strokeWidth=".7" opacity=".55" />
        </pattern>

        <clipPath id="bp-paper">
          <path d="M26 44C180 32 320 32 470 41c170 10 312 10 462 0 154-10 304-10 442 2v462c-138 12-288 12-442 2-150-10-292-10-462 0-150 9-290 9-444-3Z" />
        </clipPath>

        {/* Crease shading — light catches one side of each fold, shadow falls on the other. */}
        <linearGradient id="bp-fold" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#8a6f4e" stopOpacity="0" />
          <stop offset=".42" stopColor="#8a6f4e" stopOpacity=".22" />
          <stop offset=".5" stopColor="#6f5636" stopOpacity=".3" />
          <stop offset=".58" stopColor="#fffdf8" stopOpacity=".55" />
          <stop offset="1" stopColor="#fffdf8" stopOpacity="0" />
        </linearGradient>

        {/* Faint tooth, so the sheet reads as paper rather than flat vector. */}
        <filter id="bp-grain">
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" />
          <feColorMatrix type="saturate" values="0" />
        </filter>

        <filter id="bp-shadow" x="-8%" y="-14%" width="116%" height="132%">
          <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#5c452c" floodOpacity=".22" />
        </filter>
      </defs>

      {/* ---- paper ---- */}
      <g filter="url(#bp-shadow)">
        <path
          d="M26 44C180 32 320 32 470 41c170 10 312 10 462 0 154-10 304-10 442 2v462c-138 12-288 12-442 2-150-10-292-10-462 0-150 9-290 9-444-3Z"
          fill="#f8f4ec"
        />
      </g>

      <g clipPath="url(#bp-paper)">
        <rect x="0" y="0" width="1400" height="552" fill="url(#bp-grid)" />
        <rect x="424" y="0" width="92" height="552" fill="url(#bp-fold)" />
        <rect x="886" y="0" width="92" height="552" fill="url(#bp-fold)" />
        <rect x="26" y="0" width="34" height="552" fill="#8a6f4e" opacity=".07" />
        <rect x="1340" y="0" width="34" height="552" fill="#8a6f4e" opacity=".07" />
        <rect x="0" y="0" width="1400" height="552" filter="url(#bp-grain)" opacity=".05" />
      </g>

      {/* ---- page rules ----
          One rectangle per page, each joined to the next so neighbouring pages
          share a single edge on the fold. Nothing else may cross these lines. */}
      <g fill="none" stroke={BLUE} strokeWidth="1.8">
        <rect x="62" y="86" width="408" height="380" />
        <rect x="470" y="86" width="462" height="380" />
        <rect x="932" y="86" width="406" height="380" />
      </g>

      {/* Marks straddle the folds at 25% and 75% of the page height — where the
          staples would sit on a saddle-stitched booklet. */}
      <Mark x={470} y={181} />
      <Mark x={470} y={371} />
      <Mark x={932} y={181} />
      <Mark x={932} y={371} />

      {/* ================= 1 · YOUR IDEA ================= */}
      <Heading x={104} n="1.">YOUR IDEA</Heading>
      <text x="104" y="160" fill={BLUE} fontSize="18">
        Describe what you want to make.
      </text>

      <rect x="104" y="190" width="320" height="212" rx="16" fill="none" stroke={BLUE} strokeWidth="2" />
      {/* 26px keeps the longest line at ~260 wide, centring it in the 320 box */}
      <text x="134" y="256" fill={INK} fontSize="26">
        <tspan x="134">Make a desk pet that</tspan>
        <tspan x="134" dy="42">helps me study longer.</tspan>
      </text>

      <g stroke={BLUE} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M348 438h58" />
        <path d="M392 424l14 14-14 14" />
      </g>

      {/* ================= 2 · KIT PLAN ================= */}
      <Heading x={524} n="2.">KIT PLAN</Heading>
      <text x="524" y="160" fill={BLUE} fontSize="18">
        We prepare the parts.
      </text>

      {/* Every part carries a second contour offset inside the first — that doubled
          line is what gives the reference parts their moulded thickness. */}
      <g fill="none" stroke={BLUE} strokeWidth="2.2" strokeLinejoin="round">
        {/* front shell */}
        <rect x="512" y="196" width="106" height="118" rx="14" />
        <rect x="518" y="202" width="94" height="106" rx="10" strokeWidth="1.3" />
        <rect x="532" y="220" width="66" height="70" rx="7" />
        <rect x="536" y="224" width="58" height="62" rx="5" strokeWidth="1.1" opacity=".65" />
        <rect x="548" y="203" width="32" height="8" rx="2" strokeWidth="1.3" />
        <path d="M556 203v8M564 203v8M572 203v8" strokeWidth="1" opacity=".8" />
        <path d="M512 224h-10v18h10M512 258h-10v18h10" strokeWidth="1.8" />
        <path d="M618 224h10v18h-10M618 258h10v18h-10" strokeWidth="1.8" />
        <rect x="604" y="280" width="10" height="16" rx="2" strokeWidth="1.2" />
        <rect x="528" y="296" width="16" height="8" rx="2" strokeWidth="1.3" />
        <rect x="554" y="298" width="12" height="6" rx="2" strokeWidth="1.1" />
        <rect x="582" y="296" width="16" height="8" rx="2" strokeWidth="1.3" />
        <g strokeWidth="1.2">
          <circle cx="525" cy="209" r="2.4" />
          <circle cx="605" cy="209" r="2.4" />
          <circle cx="525" cy="301" r="2.4" />
          <circle cx="605" cy="301" r="2.4" />
        </g>

        {/* second shell */}
        <rect x="654" y="196" width="106" height="118" rx="14" />
        <rect x="660" y="202" width="94" height="106" rx="10" strokeWidth="1.3" />
        <rect x="674" y="214" width="66" height="74" rx="7" />
        <rect x="678" y="218" width="58" height="66" rx="5" strokeWidth="1.1" opacity=".65" />
        <rect x="690" y="203" width="34" height="7" rx="2" strokeWidth="1.2" />
        <rect x="688" y="294" width="38" height="11" rx="5.5" strokeWidth="1.5" />
        <path d="M694 299.5h26" strokeWidth="1" opacity=".7" />
        <g strokeWidth="1.4">
          <circle cx="668" cy="210" r="3.2" />
          <circle cx="746" cy="210" r="3.2" />
          <circle cx="668" cy="300" r="3.2" />
          <circle cx="746" cy="300" r="3.2" />
        </g>

        {/* back plate */}
        <rect x="796" y="216" width="88" height="92" rx="11" />
        <rect x="802" y="222" width="76" height="80" rx="8" strokeWidth="1.2" opacity=".6" />
        <path d="M802 234h76" strokeWidth="1.3" />
        <g strokeWidth="1.5">
          <rect x="806" y="240" width="15" height="15" rx="3" />
          <rect x="859" y="240" width="15" height="15" rx="3" />
          <rect x="806" y="282" width="15" height="15" rx="3" />
          <rect x="859" y="282" width="15" height="15" rx="3" />
        </g>
        <g strokeWidth="1" opacity=".85">
          <path d="M811 247.5h5M868 247.5h-5M811 289.5h5M868 289.5h-5" />
        </g>
        <g strokeWidth="1.1" opacity=".55">
          <path d="M832 268h5M843 268h5M840 260v5M840 271v5" />
        </g>
        <rect x="810" y="308" width="14" height="8" rx="3" strokeWidth="1.4" />
        <rect x="856" y="308" width="14" height="8" rx="3" strokeWidth="1.4" />
      </g>

      <g fill="none" stroke={BLUE} strokeWidth="2.2" strokeLinejoin="round">
        {/* looped lead with twin plugs — cord drawn as a tube so it reads as cable */}
        <path d="M600 370c-54 0-88 8-88 26s34 26 88 26v-12c-46 0-74-6-74-14s28-14 74-14Z" />
        <rect x="600" y="364" width="26" height="64" rx="7" />
        <path d="M606 372v48M613 370v52M620 372v48" strokeWidth="1.1" opacity=".7" />
        <rect x="626" y="368" width="40" height="24" rx="4" />
        <rect x="632" y="373" width="26" height="14" rx="2" strokeWidth="1.2" opacity=".75" />
        <path d="M666 374v12" strokeWidth="1.4" />
        <rect x="626" y="400" width="40" height="24" rx="4" />
        <rect x="632" y="405" width="26" height="14" rx="2" strokeWidth="1.2" opacity=".75" />
        <path d="M666 406v12" strokeWidth="1.4" />

        {/* connector block with return loop */}
        <rect x="714" y="372" width="34" height="52" rx="6" />
        <rect x="719" y="379" width="24" height="38" rx="3" strokeWidth="1.2" opacity=".7" />
        <rect x="702" y="384" width="12" height="28" rx="3" strokeWidth="1.7" />
        <path d="M706 391v14" strokeWidth="1.1" opacity=".8" />
        <path d="M748 378c60 0 92 8 92 22s-32 22-92 22v-12c48 0 78-4 78-10s-30-10-78-10Z" />
      </g>

      {/* ================= 3 · PUBLISH & SHARE ================= */}
      <Heading x={986} n="3.">PUBLISH &amp; SHARE</Heading>
      <text x="986" y="160" fill={BLUE} fontSize="18">
        Let others build it too.
      </text>

      <rect x="986" y="190" width="302" height="248" rx="12" fill="none" stroke={BLUE} strokeWidth="2" />

      <rect x="1002" y="206" width="19" height="19" rx="4" fill={BLUE} />
      <text x="1031" y="222" fill={BLUE} fontSize="24" fontWeight="700">
        Study Buddy
      </text>
      <text x="1002" y="250" fill={BLUE} fontSize="16">
        by rvei
      </text>

      {/* the finished desk pet */}
      {/* Lidded desk pet in three-quarter view: knob, domed lid, screen face,
          base rim and four castors. Centred on the card by measured bounds. */}
      {/* Back-to-front: side and top planes, knob and feet are drawn first, then the
          front face lands on top filled with the paper tone so it hides the parts
          that should sit behind it — no hidden lines to erase. */}
      {/* Drawn as a light product sketch, not an icon: hairline strokes, tonal
          planes for form, and small delicate features. */}
      {/* A real box in three-quarter view. Depth vector (+18,-14): the top and right
          faces are built on it, the front face is filled so it occludes their inner
          halves, and both seams wrap onto the right face along the same vector.
          Taller than wide, as in the reference. */}
      {/* scaled 1.2× about its own drawn centre, then placed so those bounds — not
          the front face — sit on the card's centreline */}
      <g transform="translate(1137 320) scale(1.2) translate(-1137 -320) translate(-4 1.5)">
      <g stroke={BLUE} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
        <path d="M1104 300l18-26q4-4 12-4h34q12 0 12 12v18Z" fill="#f1f5fa" />
        <path d="M1152 304l28-22v52q0 10-8 16l-20 14Z" fill="#e4ebf5" />
        {/* stands: three along the front edge, one set back beneath the right face */}
        <rect x="1161" y="350" width="8" height="8" rx="3" fill="#dde6f2" strokeWidth="1.2" />
        <rect x="1107" y="356" width="11" height="10" rx="3.5" fill={PAPER} strokeWidth="1.2" />
        <rect x="1127" y="357" width="11" height="10" rx="3.5" fill={PAPER} strokeWidth="1.2" />
        <rect x="1147" y="356" width="11" height="10" rx="3.5" fill={PAPER} strokeWidth="1.2" />
        {/* front face */}
        <rect x="1102" y="286" width="62" height="74" rx="14" fill={PAPER} />
        {/* the corner edge that sells the volume */}
        <path d="M1158 291l20-15" strokeWidth="1.3" fill="none" />
        {/* lid seam and base band, each wrapping onto the right face */}
        <path d="M1102 298h62" strokeWidth="1.2" fill="none" />
        <path d="M1164 298l15-11" strokeWidth="1.1" fill="none" opacity=".7" />
        <path d="M1103 345h61" strokeWidth="1.2" fill="none" />
        <path d="M1164 345l13-10" strokeWidth="1.1" fill="none" opacity=".7" />
        {/* knob: a button on the top face, so it reads as an ellipse at this angle */}
        <ellipse cx="1143" cy="281" rx="8" ry="4" fill="#f7f9fc" strokeWidth="1.2" />
        {/* recessed screen */}
        <rect x="1110" y="304" width="46" height="34" rx="11" fill="none" strokeWidth="1.4" />
        <rect x="1114" y="308" width="38" height="26" rx="8" fill="#eaf0f9" strokeWidth="1" />
      </g>
      <g fill={BLUE}>
        <circle cx="1126" cy="317" r="2.6" />
        <circle cx="1140" cy="317" r="2.6" />
      </g>
      <path
        d="M1127 324q6.5 6 13 0"
        fill="none"
        stroke={BLUE}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      </g>

      <path d="M986 390h302" stroke={BLUE} strokeWidth="2" />

      {/* divider at 390, card floor at 438 — both controls centre on that band (y 414) */}
      <rect x="1004" y="398" width="126" height="32" rx="6" fill={BLUE} />
      <text x="1067" y="419" fill="#fff" fontSize="16" fontWeight="700" textAnchor="middle">
        BUILD THIS
      </text>

      <path
        d="M1246 399h24v30l-12-10-12 10Z"
        fill="none"
        stroke={BLUE}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
