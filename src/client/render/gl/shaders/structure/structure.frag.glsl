#version 300 es
precision highp float;

uniform sampler2D uPalette;
uniform sampler2D uAtlas;
uniform sampler2D uAffiliation;   // 256×2 RGBA8 — row 1 = unit affiliation
uniform sampler2D uEffect;        // RGBA32F — shared effect palette, keyed by
                                  //   ownerID. The structures block starts at row
                                  //   STRUCT_EFFECT_ROW_BASE; same layout as
                                  //   trail.frag.glsl (row r = color r's rgb;
                                  //   row 0.a = count, 1.a = styleId,
                                  //   2.a = scalar0, 3.a = scalar1)
uniform float uTime;              // seconds, for animated effect styles
uniform float uHoverOwner;        // smallID of the hovered territory's owner
                                  //   (0 = none) — gates the structures effect
uniform float uDotsThreshold;
uniform float uGhostAlpha;       // 1.0 = normal, <1.0 = ghost transparency
uniform vec3  uOutlineColor;     // ghost outline color (vec3(0) = no outline)
uniform int   uAltView;
uniform int   uHighlightMask;   // bitmask of atlas columns to highlight (0 = off)
uniform float uHighlightOutlineW; // outline width for highlighted structures
uniform float uHighlightDimAlpha; // alpha multiplier for non-highlighted structures
uniform float uFillDarken;      // HSV value multiplier on icon fill
uniform float uBorderDarken;    // HSV value multiplier on icon border
uniform float uIconAlpha;       // global multiplier on final icon alpha
uniform vec3  uIconColor;       // color of the inner icon glyph (was white)
uniform float uIconDarken;      // >0: glyph = darkened player color instead of uIconColor
uniform float uLocalPlayerID;

in vec2  vLocalPos;
in vec2  vAtlasUV;
flat in float vOwnerID;
flat in float vUnderConstruction;
flat in float vMarkedForDeletion;
flat in float vZoom;
flat in float vAtlasIdx;
flat in float vShapeScale;

out vec4 fragColor;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec3 darken(vec3 rgb, float vScale) {
  vec3 hsv = rgb2hsv(rgb);
  hsv.z *= vScale;
  return hsv2rgb(hsv);
}

// The owner's structures cosmetic color, if equipped. Reads the structures
// block of the shared effect palette; the gradient/transition math mirrors
// trail.frag.glsl so the same catalog attributes look identical on both.
// Returns false when the owner has no structures effect (count 0).
bool structuresEffectColor(int owner, out vec3 color) {
  const int rowBase = STRUCT_EFFECT_ROW_BASE;
  int count = int(texelFetch(uEffect, ivec2(owner, rowBase), 0).a + 0.5);
  if (count <= 0) return false;
  if (count == 1) {
    // Single color — flat recolor.
    color = texelFetch(uEffect, ivec2(owner, rowBase), 0).rgb;
  } else if (int(texelFetch(uEffect, ivec2(owner, rowBase + 1), 0).a + 0.5) == 1) {
    // transition — one color at a time, cross-fading through the list.
    // frequency = color changes per second.
    float frequency = texelFetch(uEffect, ivec2(owner, rowBase + 2), 0).a;
    float t = uTime * frequency;
    int i = int(t) % count;
    int j = (i + 1) % count;
    vec3 a = texelFetch(uEffect, ivec2(owner, rowBase + i), 0).rgb;
    vec3 b = texelFetch(uEffect, ivec2(owner, rowBase + j), 0).rgb;
    color = mix(a, b, fract(t));
  } else {
    // gradient — the palette spans the icon's diagonal once, so the whole
    // gradient is visible across the shape (world-space banding like the
    // trail's would put the entire icon inside one band and read as a flat
    // color). It scrolls along the diagonal at the trail-equivalent pace:
    // one full slide every colorSize · count / movementSpeed seconds,
    // so both knobs keep their trail timing semantics.
    float colorSize = max(texelFetch(uEffect, ivec2(owner, rowBase + 2), 0).a, 0.001);
    float movementSpeed = texelFetch(uEffect, ivec2(owner, rowBase + 3), 0).a;
    float dn = (vLocalPos.x + vLocalPos.y) * 0.5; // icon diagonal, -0.5..0.5
    float phase =
      fract(dn - uTime * movementSpeed / (colorSize * float(count)));
    float f = phase * float(count);
    int i = int(f) % count;
    int j = (i + 1) % count;
    vec3 a = texelFetch(uEffect, ivec2(owner, rowBase + i), 0).rgb;
    vec3 b = texelFetch(uEffect, ivec2(owner, rowBase + j), 0).rgb;
    color = mix(a, b, fract(f));
  }
  return true;
}

#define PI 3.14159265

// Signed distance to regular polygon edge.
// R = circumradius (center-to-vertex), n = sides, rot = rotation in radians.
// Returns negative inside, positive outside.
float sdPolygon(vec2 p, float R, float n, float rot) {
  float an = PI / n;
  float a = atan(p.y, p.x) - rot;
  a = mod(a + an, 2.0 * an) - an;
  return length(p) * cos(a) - R * cos(an);
}

// Five-point star, one vertex up (iq's sdStar5). r = outer radius, rf = inner/outer ratio.
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}

// Per-structure-type shape SDF.
// Atlas indices: 0=City, 1=Port, 2=Factory, 3=DefensePost, 4=SAM, 5=Silo, 6=Capital
float shapeSDF(vec2 p, float R) {
  if (vAtlasIdx < 0.5)
    return length(p) - R;                     // City → circle
  if (vAtlasIdx < 1.5)
    return sdPolygon(p, R, 5.0, PI * 0.5);    // Port → pentagon (vertex up)
  if (vAtlasIdx < 2.5)
    return sdPolygon(p, R, 6.0, PI / 6.0);    // Factory → hexagon (flat top)
  if (vAtlasIdx < 3.5)
    return sdPolygon(p, R, 8.0, 0.0);         // Defense Post → octagon (flat top)
  if (vAtlasIdx < 4.5)
    return sdPolygon(p, R, 4.0, 0.0);         // SAM Launcher → square (flat sides)
  if (vAtlasIdx < 5.5)
    return sdPolygon(p, R, 3.0, PI * 0.5);    // Missile Silo → triangle (vertex up)
  return sdStar5(vec2(p.x, -p.y), R, 0.62);  // Capital → star (y flipped: vertex up on screen)
}

// Atlas: top half is the building art, bottom half the owner-accent mask
// (scripts/genStructureAtlas.ts). Samples one half, clamped to this column.
vec4 sampleAtlas(vec2 uv, float half_) {
  float colStart = vAtlasIdx / float(ATLAS_COLS);
  float colEnd = (vAtlasIdx + 1.0) / float(ATLAS_COLS);
  if (uv.x < colStart || uv.x > colEnd || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  return texture(uAtlas, vec2(uv.x, clamp(uv.y, 0.01, 0.99) * 0.5 + half_ * 0.5));
}

// Zoomed-in building: pixel art on the terrain, owner colour in its accents.
vec4 drawArt(vec3 ownerRGB, float fw) {
  vec4 art = sampleAtlas(vAtlasUV, 0.0);
  float accent = sampleAtlas(vAtlasUV, 1.0).a;
  vec3 rgb = mix(art.rgb, ownerRGB * art.rgb, accent);
  if (vUnderConstruction > 0.5) {
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    rgb = mix(rgb, vec3(lum), 0.8);
  }
  float alpha = art.a;

  if (vMarkedForDeletion > 0.5) {
    float lineW = max(0.025, fw * 1.5);
    float d1 = abs(vLocalPos.x - vLocalPos.y) * 0.7071;
    float d2 = abs(vLocalPos.x + vLocalPos.y) * 0.7071;
    float xLine = (1.0 - smoothstep(lineW - fw, lineW + fw, min(d1, d2)))
                * (1.0 - smoothstep(0.38, 0.4, length(vLocalPos)));
    rgb = mix(rgb, vec3(1.0, 0.25, 0.25), xLine * 0.95);
    alpha = max(alpha, xLine * 0.95);
  }

  float tintActive = step(0.01, dot(uOutlineColor, uOutlineColor));
  rgb = mix(rgb, uOutlineColor, tintActive * 0.5);
  alpha *= uGhostAlpha * uIconAlpha;

  if (uHighlightMask != 0) {
    int bit = 1 << int(vAtlasIdx + 0.5);
    if ((uHighlightMask & bit) != 0) {
      // White outline hugging the art: art alpha a few texels away, minus its own.
      vec2 o = vec2(1.5 / (64.0 * float(ATLAS_COLS)), 1.5 / 64.0);
      float near = max(max(sampleAtlas(vAtlasUV + vec2(o.x, 0.0), 0.0).a,
                           sampleAtlas(vAtlasUV - vec2(o.x, 0.0), 0.0).a),
                       max(sampleAtlas(vAtlasUV + vec2(0.0, o.y), 0.0).a,
                           sampleAtlas(vAtlasUV - vec2(0.0, o.y), 0.0).a));
      float band = clamp(near - art.a, 0.0, 1.0);
      rgb = mix(rgb, vec3(1.0), band);
      alpha = max(alpha, band);
    } else {
      alpha *= uHighlightDimAlpha;
    }
  }
  if (alpha <= 0.0) discard;
  return vec4(rgb, alpha);
}

void main() {
  float dist = length(vLocalPos);
  float radius = 0.45;
  float borderWidth = 0.06 / vShapeScale;

  float sdf = shapeSDF(vLocalPos, radius);
  float fw = fwidth(dist);

  // When highlight is active, expand the region to include the outer outline band.
  float highlightOutlineW = uHighlightMask != 0 ? uHighlightOutlineW / vShapeScale : 0.0;
  float outerAlpha = 1.0 - smoothstep(-fw, fw, sdf - highlightOutlineW);

  // Zoomed in, buildings are pixel art sized by the quad, not by the badge shape.
  bool artMode = vZoom > uDotsThreshold;
  if (outerAlpha <= 0.0 && !artMode) discard;

  float borderMask = 1.0 - smoothstep(-fw, fw, sdf + borderWidth);

  // Player color
  vec4 fillColor;
  vec3 ownerRGB; // undarkened owner colour, painted into the art's accents
  vec4 borderColor;

  if (uAltView != 0 && vUnderConstruction < 0.5) {
    vec3 ac = texelFetch(uAffiliation, ivec2(int(vOwnerID), 1), 0).rgb;
    ownerRGB = ac;
    fillColor = vec4(darken(ac, uFillDarken), 1.0);
    borderColor = vec4(darken(ac, uBorderDarken), 1.0);
  } else if (vUnderConstruction > 0.5) {
    ownerRGB = vec3(198.0/255.0);
    fillColor = vec4(198.0/255.0, 198.0/255.0, 198.0/255.0, 1.0);
    borderColor = vec4(127.0/255.0, 127.0/255.0, 127.0/255.0, 1.0);
  } else {
    int owner = int(vOwnerID + 0.5);
    int local = int(uLocalPlayerID);
    float u = (vOwnerID + 0.5) / float(PALETTE_SIZE);
    fillColor = texture(uPalette, vec2(u, 0.25));
    ownerRGB = fillColor.rgb;
    // if local player, use territory color because the border color is grey
    borderColor = texture(uPalette, vec2(u, owner == local ? 0.25 : 0.75));
    // Darken via HSV value so hue/saturation stay intact
    // vScale < 1.0 = darker, > 1.0 = brighter
    fillColor.rgb = darken(fillColor.rgb, uFillDarken);
    borderColor.rgb = darken(borderColor.rgb, uBorderDarken);
    fillColor.a = 1.0;
    borderColor.a = 1.0;
  }

  // structures cosmetic: recolor the fill with the owner's effect (raw catalog
  // colors, like trails — no darken) while their territory is hovered. The
  // local player's own effect always shows — touch devices never hover, and
  // buyers should see what they paid for. The border keeps the player color
  // so ownership stays readable. Skipped for alt view and construction gray.
  bool effectActive = false;
  if (uAltView == 0 && vUnderConstruction < 0.5) {
    int effOwner = int(vOwnerID + 0.5);
    if ((effOwner == int(uHoverOwner + 0.5) ||
         effOwner == int(uLocalPlayerID)) && effOwner > 0) {
      vec3 effectRGB;
      if (structuresEffectColor(effOwner, effectRGB)) {
        fillColor.rgb = effectRGB;
        ownerRGB = effectRGB;
        effectActive = true;
      }
    }
  }

  if (artMode) {
    fragColor = drawArt(ownerRGB, fw);
    return;
  }

  vec4 bgColor = mix(borderColor, fillColor, borderMask);

  // Sample icon from atlas (white on transparent)
  // Only show icon detail when zoomed in enough
  float iconAlpha = 0.0;
  if (vZoom > uDotsThreshold) {
    // Clamp UV to this atlas column to prevent bleeding into neighbours
    // when uIconFill shrinks the icon (expanding UV range beyond column).
    float colStart = vAtlasIdx / float(ATLAS_COLS);
    float colEnd = (vAtlasIdx + 1.0) / float(ATLAS_COLS);
    vec2 safeUV = vec2(clamp(vAtlasUV.x, colStart, colEnd), clamp(vAtlasUV.y, 0.0, 1.0));
    vec4 iconSample = texture(uAtlas, vec2(safeUV.x, safeUV.y * 0.5));
    // Zero out icon outside the valid UV region (clamped pixels would repeat the edge)
    float inBounds = step(colStart, vAtlasUV.x) * step(vAtlasUV.x, colEnd)
                   * step(0.0, vAtlasUV.y) * step(vAtlasUV.y, 1.0);
    // Clip to fill area so icon doesn't bleed into the border ring.
    iconAlpha = iconSample.a * borderMask * inBounds;
  }

  // Composite: tinted icon over player-colored shape.
  // Classic icons (uIconDarken > 0) tint the glyph with a darkened player
  // color. When the shape itself is already dark, that darkened glyph blends
  // into the shape (and the dark territory behind it) and becomes unreadable —
  // so flip the glyph to the light icon color when the fill is too dark.
  // While the structures effect is animating the fill, the flip becomes a
  // smooth luminance fade so the glyph cross-fades instead of snapping;
  // without the effect this is the classic hard threshold, pixel-identical
  // to having no cosmetic equipped.
  vec3 glyphColor = uIconColor;
  if (uIconDarken > 0.0) {
    float fillLum = dot(fillColor.rgb, vec3(0.299, 0.587, 0.114));
    if (effectActive) {
      float t = smoothstep(0.25, 0.45, fillLum); // 0 = dark fill → light glyph
      glyphColor = mix(uIconColor, darken(fillColor.rgb, uIconDarken), t);
    } else {
      glyphColor =
        fillLum < 0.25 ? uIconColor : darken(fillColor.rgb, uIconDarken);
    }
  }
  vec3 finalRGB = mix(bgColor.rgb, glyphColor, iconAlpha);

  // Red X overlay for units marked for deletion
  if (vMarkedForDeletion > 0.5) {
    float lineW = max(0.025, fw * 1.5);
    float d1 = abs(vLocalPos.x - vLocalPos.y) * 0.7071; // dist to y=x diagonal
    float d2 = abs(vLocalPos.x + vLocalPos.y) * 0.7071; // dist to y=-x diagonal
    float dMin = min(d1, d2);
    // Extend arms close to the circle edge
    float maskR = max(radius * 1.55, fw * 6.0);
    float mask = 1.0 - smoothstep(maskR - fw, maskR, dist);
    float xLine = (1.0 - smoothstep(lineW - fw, lineW + fw, dMin)) * mask;
    finalRGB = mix(finalRGB, vec3(1.0, 0.25, 0.25), xLine * 0.95);
  }

  // Ghost tint — blend entire surface toward uOutlineColor when non-zero
  float tintActive = step(0.01, dot(uOutlineColor, uOutlineColor));
  finalRGB = mix(finalRGB, uOutlineColor, tintActive * 0.5);

  float finalAlpha = bgColor.a * outerAlpha * uGhostAlpha * uIconAlpha;

  // Build-button hover highlight: white outline on matching types, dim the rest
  if (uHighlightMask != 0) {
    int bit = 1 << int(vAtlasIdx + 0.5);
    if ((uHighlightMask & bit) != 0) {
      // White outline band outside the shape edge (matches game's OutlineFilter)
      float shapeEdge = 1.0 - smoothstep(-fw, fw, sdf);           // 1 inside shape, 0 outside
      float expandedEdge = 1.0 - smoothstep(-fw, fw, sdf - highlightOutlineW); // includes outline band
      float outlineBand = expandedEdge - shapeEdge;                // 1 in outline region only
      finalRGB = mix(finalRGB, vec3(1.0), outlineBand);
      finalAlpha = max(finalAlpha, outlineBand);
    } else {
      finalAlpha *= uHighlightDimAlpha;
    }
  }

  fragColor = vec4(finalRGB, finalAlpha);
}
