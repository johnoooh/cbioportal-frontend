import {
    Exon,
    ProteinDomain,
    TranscriptData,
    GenePartner,
    RetainedDomain,
    SvIdiom,
} from '../data/types';

// ---------------------------------------------------------------------------
// Domain truncation constants
// ---------------------------------------------------------------------------
/**
 * A domain is styled "intact" only when the fraction retained is at or above
 * this threshold. Below it the domain is rendered with a ghost/hatched stub
 * and a truncation badge. Adjust to tune sensitivity.
 */
export const DOMAIN_TRUNCATION_THRESHOLD = 0.9;

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
export const PRODUCT_HEIGHT = 20;
export const EXON_GAP = 2;
// Gap between the 5′ and 3′ exon blocks at the fusion junction (where the
// breakpoint diamond used to be). Small — just enough to read as a seam.
export const JUNCTION_GAP = 14;
// Floor on a drawn exon width so very short exons stay visible / clickable.
const MIN_EXON_W = 4;
// Font size of the per-exon labels under the product ladder.
export const EXON_LABEL_FONT_SIZE = 8;
// Rough advance width of one character as a fraction of font size, for the
// common sans-serif digits/letters used in exon labels ("E12"). Deliberately
// an estimate: measuring real text would need a rendered DOM, and the only
// decision it drives is whether a label is legible enough to draw at all.
const CHAR_WIDTH_RATIO = 0.6;

/**
 * Split one exon's drawn block into coding / UTR pieces, in absolute px.
 *
 * The product ladder used to collapse each exon to a single boolean ("is this
 * exon entirely untranslated?"), which meant a terminal exon with a short
 * coding head and a long UTR tail -- IGF2R's final exon is the case -- drew at
 * full height as the largest apparently-coding block in the whole product,
 * while the protein-domain backbone underneath visibly ran out long before it.
 *
 * `splitFn` is injected to avoid importing GeneTrack here (GeneTrack imports
 * this module, and a cycle would be worse than a parameter).
 *
 * Blocks are drawn 5'->3' left-to-right, so on a minus-strand gene the genomic
 * order within the block is reversed: the 3'UTR sits at the LOWER coordinate
 * but must still be drawn on the right.
 */
export function exonBlockSegments(
    exon: { start: number; end: number },
    utrs: { start: number; end: number; type: 'five_prime' | 'three_prime' }[],
    strand: '+' | '-',
    blockX: number,
    blockWidth: number,
    splitFn: (
        e: { start: number; end: number },
        u: typeof utrs
    ) => { start: number; end: number; isUtr: boolean }[] = defaultSplit
): { x: number; width: number; isUtr: boolean }[] {
    const pieces = splitFn(exon, utrs || []);
    if (pieces.length <= 1) {
        return [
            {
                x: blockX,
                width: blockWidth,
                isUtr: pieces.length === 1 ? pieces[0].isUtr : false,
            },
        ];
    }

    const len = Math.max(1, exon.end - exon.start + 1);
    const ordered =
        strand === '-'
            ? [...pieces].sort((a, b) => b.start - a.start)
            : [...pieces].sort((a, b) => a.start - b.start);

    return ordered.map(p => {
        const pieceLen = Math.max(0, p.end - p.start + 1);
        const offset = strand === '-' ? exon.end - p.end : p.start - exon.start;
        return {
            x: blockX + (offset / len) * blockWidth,
            width: (pieceLen / len) * blockWidth,
            isUtr: p.isUtr,
        };
    });
}

/**
 * Fallback splitter used when no `splitFn` is supplied: treats the exon as one
 * coding piece. Real callers pass GeneTrack's splitExonByUtr.
 */
function defaultSplit(e: {
    start: number;
    end: number;
}): { start: number; end: number; isUtr: boolean }[] {
    return [{ ...e, isUtr: false }];
}

/** Estimated rendered width of a short SVG text label, in px. */
export function estimateLabelWidth(
    label: string,
    fontSize: number = EXON_LABEL_FONT_SIZE
): number {
    return label.length * fontSize * CHAR_WIDTH_RATIO;
}

/**
 * Choose which exon labels to draw, greedily from left to right.
 *
 * Returns the keys of the labels to render. A label is kept when it clears the
 * right edge of the last kept label, so labels may overhang their own block
 * into the gaps around it -- what matters is that two DRAWN labels never
 * collide, not that each fits its block. Judging each label against its own
 * block alone (the previous rule) ignored that free space and, because the
 * test then turned on digit count, dropped "E10" while keeping the equally
 * cramped "E9" -- giving a sparse and visibly arbitrary set.
 *
 * Input order does not matter: minus-strand gene tracks draw their exons
 * right-to-left, so the list is sorted by centre before the walk rather than
 * trusting callers to pre-sort.
 */
export function selectVisibleExonLabels(
    labels: Array<{ key: string; centerX: number; text: string }>,
    fontSize: number = EXON_LABEL_FONT_SIZE,
    minGap: number = 2
): Set<string> {
    const keep = new Set<string>();
    let lastRight = -Infinity;
    const ordered = [...labels].sort((a, b) => a.centerX - b.centerX);
    ordered.forEach(({ key, centerX, text }) => {
        const half = estimateLabelWidth(text, fontSize) / 2;
        if (centerX - half >= lastRight) {
            keep.add(key);
            lastRight = centerX + half + minGap;
        }
    });
    return keep;
}

// ---------------------------------------------------------------------------
// Exon selection logic
// ---------------------------------------------------------------------------

/**
 * Select exons from the 5-prime gene that are retained in the fusion product.
 *
 * For + strand: exons whose start <= breakpoint
 * For - strand: exons whose end >= breakpoint
 */
export function select5PrimeExons(
    exons: Exon[],
    breakpointPos: number,
    strand: '+' | '-'
): Exon[] {
    if (strand === '+') {
        return exons.filter(e => e.start <= breakpointPos);
    } else {
        return exons.filter(e => e.end >= breakpointPos);
    }
}

/**
 * Select exons from the 3-prime gene that are retained in the fusion product.
 *
 * For + strand: exons whose end >= breakpoint
 * For - strand: exons whose start <= breakpoint
 */
export function select3PrimeExons(
    exons: Exon[],
    breakpointPos: number,
    strand: '+' | '-'
): Exon[] {
    if (strand === '+') {
        return exons.filter(e => e.end >= breakpointPos);
    } else {
        return exons.filter(e => e.start <= breakpointPos);
    }
}

/**
 * Resolve the effective 5′ / 3′ breakpoints that drive product/gene-track exon
 * selection. Pure so the strand logic can be exhaustively tested.
 *
 * For two-gene fusions (and any non-intragenic idiom) gene1 is the resolved 5′
 * partner, so its position is the 5′ breakpoint and gene2's the 3′ — returned
 * unchanged.
 *
 * For INTRAGENIC deletion/duplication BOTH breakpoints lie on one transcript, so
 * 5′/3′ assignment must follow STRAND + POSITION, not the arbitrary site1/site2
 * (gene1/gene2) order — on minus-strand genes that order is reversed relative to
 * transcription. We derive upstream (5′-ward) / downstream (3′-ward) from
 * min/max by strand:
 *   + strand: upstream = lower position,  downstream = higher position
 *   − strand: upstream = higher position, downstream = lower position
 * DELETION keeps the exons OUTSIDE the segment → 5′ = upstream, 3′ = downstream
 * (the gap between the retained sets is the deletion).
 * DUPLICATION keeps/overlaps the INSIDE segment → swapped, so the 5′ and 3′
 * retained sets overlap over the duplicated exons (tandem repeat).
 */
export function resolveProductBreakpoints(
    svIdiom: SvIdiom,
    strand5p: '+' | '-',
    gene1Position: number,
    gene2Position: number | undefined
): { breakpoint5p: number; breakpoint3p: number | undefined } {
    const isIntragenicProduct =
        svIdiom === 'INTRAGENIC_DELETION' ||
        svIdiom === 'INTRAGENIC_DUPLICATION';
    if (!isIntragenicProduct || gene2Position === undefined) {
        return { breakpoint5p: gene1Position, breakpoint3p: gene2Position };
    }
    const hi = Math.max(gene1Position, gene2Position);
    const lo = Math.min(gene1Position, gene2Position);
    const upstream = strand5p === '-' ? hi : lo;
    const downstream = strand5p === '-' ? lo : hi;
    if (svIdiom === 'INTRAGENIC_DUPLICATION') {
        return { breakpoint5p: downstream, breakpoint3p: upstream };
    }
    return { breakpoint5p: upstream, breakpoint3p: downstream };
}

/**
 * Linear interpolation of a breakpoint genomic position onto a domain's AA
 * coordinate space. Used only for domains the breakpoint actually intersects.
 *
 * The interpolation accounts for strand:
 *   + strand: AA increases with genomic position
 *   - strand: AA increases as genomic position decreases
 *
 * Returns `domain.startAA` when the genomic span is zero (degenerate case).
 */
export function breakpointToDomainAA(
    domain: ProteinDomain,
    breakpointGenomic: number,
    strand: '+' | '-'
): number {
    const gSpan = domain.endGenomic - domain.startGenomic;
    if (gSpan === 0) return domain.startAA;
    const aaSpan = domain.endAA - domain.startAA;
    const rawFrac = (breakpointGenomic - domain.startGenomic) / gSpan;
    const frac = strand === '+' ? rawFrac : 1 - rawFrac;
    return domain.startAA + frac * aaSpan;
}

/**
 * Build a RetainedDomain for a domain that is fully retained (breakpoint does
 * not intersect it).
 */
function makeFullRetainedDomain(
    domain: ProteinDomain,
    side: '5p' | '3p'
): RetainedDomain {
    return {
        domain,
        side,
        retainedStartAA: domain.startAA,
        retainedEndAA: domain.endAA,
        isTruncated: false,
        retainedFraction: 1,
        lostStartAA: domain.endAA,
        lostEndAA: domain.endAA,
    };
}

/**
 * Build a RetainedDomain for a domain that straddles the breakpoint.
 * For the 5′ side we retain [startAA, bpAA]; for the 3′ side [bpAA, endAA].
 */
function makeTruncatedRetainedDomain(
    domain: ProteinDomain,
    side: '5p' | '3p',
    bpAA: number
): RetainedDomain {
    const fullLen = domain.endAA - domain.startAA + 1;
    let retainedStartAA: number;
    let retainedEndAA: number;
    let lostStartAA: number;
    let lostEndAA: number;

    if (side === '5p') {
        retainedStartAA = domain.startAA;
        retainedEndAA = Math.min(domain.endAA, Math.max(domain.startAA, bpAA));
        lostStartAA = retainedEndAA;
        lostEndAA = domain.endAA;
    } else {
        retainedStartAA = Math.max(
            domain.startAA,
            Math.min(domain.endAA, bpAA)
        );
        retainedEndAA = domain.endAA;
        lostStartAA = domain.startAA;
        lostEndAA = retainedStartAA;
    }

    const retainedLen = retainedEndAA - retainedStartAA + 1;
    const retainedFraction = Math.min(1, Math.max(0, retainedLen / fullLen));
    const isTruncated = retainedFraction < DOMAIN_TRUNCATION_THRESHOLD;

    return {
        domain,
        side,
        retainedStartAA,
        retainedEndAA,
        isTruncated,
        retainedFraction,
        lostStartAA,
        lostEndAA,
    };
}

/**
 * Select protein domains retained on the 5-prime side of a fusion.
 *
 * A domain is retained if any portion of its genomic footprint lies on the
 * 5-prime side of the breakpoint, using the same inclusive rule as
 * select5PrimeExons:
 *   + strand: startGenomic <= breakpoint
 *   - strand: endGenomic   >= breakpoint
 *
 * Domains straddling the breakpoint are clipped to the retained AA interval
 * and returned with `isTruncated = true` when the retained fraction is below
 * DOMAIN_TRUNCATION_THRESHOLD.
 */
export function select5PrimeDomains(
    domains: ProteinDomain[],
    breakpointPos: number,
    strand: '+' | '-'
): RetainedDomain[] {
    return domains
        .filter(d =>
            strand === '+'
                ? d.startGenomic <= breakpointPos
                : d.endGenomic >= breakpointPos
        )
        .map(d => {
            // Check if the breakpoint falls strictly inside this domain.
            const straddlesFwd =
                strand === '+' &&
                d.startGenomic <= breakpointPos &&
                breakpointPos < d.endGenomic;
            const straddlesRev =
                strand === '-' &&
                d.startGenomic < breakpointPos &&
                breakpointPos <= d.endGenomic;
            if (straddlesFwd || straddlesRev) {
                const bpAA = breakpointToDomainAA(d, breakpointPos, strand);
                return makeTruncatedRetainedDomain(d, '5p', bpAA);
            }
            return makeFullRetainedDomain(d, '5p');
        });
}

/**
 * Select protein domains retained on the 3-prime side of a fusion.
 *
 *   + strand: endGenomic   >= breakpoint
 *   - strand: startGenomic <= breakpoint
 *
 * Domains straddling the breakpoint are clipped to the retained AA interval.
 */
export function select3PrimeDomains(
    domains: ProteinDomain[],
    breakpointPos: number,
    strand: '+' | '-'
): RetainedDomain[] {
    return domains
        .filter(d =>
            strand === '+'
                ? d.endGenomic >= breakpointPos
                : d.startGenomic <= breakpointPos
        )
        .map(d => {
            const straddlesFwd =
                strand === '+' &&
                d.startGenomic < breakpointPos &&
                breakpointPos <= d.endGenomic;
            const straddlesRev =
                strand === '-' &&
                d.startGenomic <= breakpointPos &&
                breakpointPos < d.endGenomic;
            if (straddlesFwd || straddlesRev) {
                const bpAA = breakpointToDomainAA(d, breakpointPos, strand);
                return makeTruncatedRetainedDomain(d, '3p', bpAA);
            }
            return makeFullRetainedDomain(d, '3p');
        });
}

export interface GhostStubRect {
    ghostX: number;
    ghostWidth: number;
}

/**
 * Geometry for a truncated domain's lost-portion "ghost" stub, capped so it
 * never spills past the domain's own on-screen footprint [domainLeft, domainRight]
 * (whose far edge ≈ the fusion junction). Without the cap, the MIN_DOMAIN_W
 * floor applied to the solid retained rect pushes the ghost past the junction at
 * very low retention, overrunning the 3′ partner's domains.
 *
 * 5′ domains keep their retained solid on the left and the ghost extends right;
 * 3′ domains keep the solid on the right and the ghost fills left to the solid
 * edge. A cap that lands at 0 leaves only the truncation badge (the caller
 * suppresses sub-MIN_GHOST_W stubs), so truncation is never silently lost.
 */
export function ghostStubRect(
    side: '5p' | '3p',
    solidX: number,
    solidWidth: number,
    lostSvgWidth: number,
    domainLeft: number,
    domainRight: number
): GhostStubRect {
    if (side === '5p') {
        const ghostX = solidX + solidWidth;
        return {
            ghostX,
            ghostWidth: Math.max(
                0,
                Math.min(lostSvgWidth, domainRight - ghostX)
            ),
        };
    }
    const ghostWidth = Math.max(0, Math.min(lostSvgWidth, solidX - domainLeft));
    return { ghostX: solidX - ghostWidth, ghostWidth };
}

export interface FusionExonLayout {
    /** Drawn width (px) of each retained 5′ exon, in order. */
    widths5p: number[];
    /** Drawn width (px) of each retained 3′ exon, in order. */
    widths3p: number[];
    /** Left-edge x (px) of each retained 5′ exon block, in order. */
    xs5p: number[];
    /** Left-edge x (px) of each retained 3′ exon block, in order. */
    xs3p: number[];
    /** Left edge of the first exon. */
    startX: number;
    /** Center of the junction gap between the 5′ and 3′ blocks. */
    junctionX: number;
}

/**
 * Retained exons for one partner, sorted into transcription order (5′→3′) —
 * the same order the fusion product lays them out left-to-right. Sharing this
 * helper keeps FusionProduct and ProteinDomainTrack on an identical exon
 * sequence so domains can be aligned under the exons that encode them.
 */
export function retainedExonsInOrder(
    transcript: TranscriptData,
    breakpointPos: number,
    is5Prime: boolean
): Exon[] {
    const sorted = [...transcript.exons].sort((a, b) =>
        transcript.strand === '-' ? b.start - a.start : a.start - b.start
    );
    return is5Prime
        ? select5PrimeExons(sorted, breakpointPos, transcript.strand)
        : select3PrimeExons(sorted, breakpointPos, transcript.strand);
}

/**
 * Shared fusion-product exon layout. Exon rectangles are drawn TO SCALE —
 * each width is proportional to that exon's genomic length (bp) — with a small
 * floor so very short exons stay visible. Used by both FusionProduct (to place
 * the exon rects) and computeJunctionX (to place the connecting arcs) so the
 * two cannot drift apart.
 */
export function computeFusionExonLayout(
    retained5p: Exon[],
    retained3p: Exon[],
    x: number,
    width: number
): FusionExonLayout {
    const startX = x + 10;
    const totalExons = retained5p.length + retained3p.length;
    const exonLen = (e: Exon) => Math.max(1, e.end - e.start);
    const totalLen =
        [...retained5p, ...retained3p].reduce((s, e) => s + exonLen(e), 0) || 1;
    const availableWidth =
        width - JUNCTION_GAP - EXON_GAP * Math.max(0, totalExons - 1) - 20;

    // Apportion `availableWidth` proportionally, but honour MIN_EXON_W WITHOUT
    // overspending the box. Flooring after a proportional split (the previous
    // behaviour) silently inflated the total whenever short exons hit the
    // floor, so the ladder and the trailing 3' label overran the panel. Instead
    // settle which exons are floored first, then re-apportion what is left over
    // the rest -- repeating, because giving a floored exon its minimum shrinks
    // the budget and can push another exon below the floor in turn.
    const allExons = [...retained5p, ...retained3p];
    const widthOf = new Map<Exon, number>();
    let freeExons = allExons;
    let budget = availableWidth;

    if (allExons.length * MIN_EXON_W > availableWidth) {
        // Physically impossible to honour the floor. Split evenly and let the
        // blocks be thin rather than let the ladder escape its box.
        const even = Math.max(0.5, availableWidth / allExons.length);
        allExons.forEach(e => widthOf.set(e, even));
    } else {
        for (;;) {
            const freeLen = freeExons.reduce((s, e) => s + exonLen(e), 0) || 1;
            const tooSmall = freeExons.filter(
                e => (exonLen(e) / freeLen) * budget < MIN_EXON_W
            );
            if (tooSmall.length === 0) {
                freeExons.forEach(e =>
                    widthOf.set(e, (exonLen(e) / freeLen) * budget)
                );
                break;
            }
            tooSmall.forEach(e => widthOf.set(e, MIN_EXON_W));
            budget -= tooSmall.length * MIN_EXON_W;
            freeExons = freeExons.filter(e => !tooSmall.includes(e));
            if (freeExons.length === 0) break;
        }
    }

    const scaleW = (e: Exon) => widthOf.get(e) ?? MIN_EXON_W;
    const widths5p = retained5p.map(scaleW);
    const widths3p = retained3p.map(scaleW);

    const xs5p: number[] = [];
    let cursor = startX;
    widths5p.forEach(w => {
        xs5p.push(cursor);
        cursor += w + EXON_GAP;
    });
    const junctionX = cursor + JUNCTION_GAP / 2;
    cursor += JUNCTION_GAP;
    const xs3p: number[] = [];
    widths3p.forEach(w => {
        xs3p.push(cursor);
        cursor += w + EXON_GAP;
    });

    return { widths5p, widths3p, xs5p, xs3p, startX, junctionX };
}

/**
 * Map a genomic coordinate to its x in the to-scale fusion exon layout, so a
 * protein domain can be drawn directly under the exons that encode it.
 * `exons`, `xs`, and `widths` are the retained exons in transcription order
 * with their drawn block left-edges and widths. A coordinate inside an exon
 * interpolates within that block (strand-aware); one in an intron or beyond
 * the retained set clamps to the nearest exon edge.
 */
export function genomicToExonX(
    genomicPos: number,
    exons: Exon[],
    xs: number[],
    widths: number[],
    strand: '+' | '-'
): number {
    if (exons.length === 0) return 0;
    const fracIn = (e: Exon) =>
        strand === '+'
            ? (genomicPos - e.start) / Math.max(1, e.end - e.start)
            : (e.end - genomicPos) / Math.max(1, e.end - e.start);

    for (let i = 0; i < exons.length; i++) {
        const e = exons[i];
        if (genomicPos >= e.start && genomicPos <= e.end) {
            return xs[i] + fracIn(e) * widths[i];
        }
    }

    // Outside all exons. exons[0] is the 5′-most (leftmost) block.
    const first = exons[0];
    const last = exons[exons.length - 1];
    const upstreamOfFirst =
        strand === '+' ? genomicPos < first.start : genomicPos > first.end;
    if (upstreamOfFirst) return xs[0];
    const downstreamOfLast =
        strand === '+' ? genomicPos > last.end : genomicPos < last.start;
    if (downstreamOfLast) {
        const li = exons.length - 1;
        return xs[li] + widths[li];
    }
    // In an intron between two exon blocks → clamp to the preceding block edge.
    for (let i = 0; i < exons.length - 1; i++) {
        const e = exons[i];
        const next = exons[i + 1];
        const between =
            strand === '+'
                ? genomicPos > e.end && genomicPos < next.start
                : genomicPos < e.start && genomicPos > next.end;
        if (between) return xs[i] + widths[i];
    }
    return xs[0];
}

/**
 * Compute the junction x position for connecting arcs. Delegates to the shared
 * layout so arcs land exactly on the FusionProduct junction.
 */
export function computeJunctionX(
    gene1: GenePartner,
    gene2: GenePartner | null,
    forteTranscript5p: TranscriptData,
    forteTranscript3p: TranscriptData | undefined,
    x: number,
    width: number
): number {
    if (!gene2 || !forteTranscript3p) {
        return x + width / 2;
    }

    const sorted5p = [...forteTranscript5p.exons].sort(
        (a, b) => a.number - b.number
    );
    const sorted3p = [...forteTranscript3p.exons].sort(
        (a, b) => a.number - b.number
    );

    const retained5p = select5PrimeExons(
        sorted5p,
        gene1.position,
        forteTranscript5p.strand
    );
    const retained3p = select3PrimeExons(
        sorted3p,
        gene2.position,
        forteTranscript3p.strand
    );

    if (retained5p.length + retained3p.length === 0) return x + width / 2;

    return computeFusionExonLayout(retained5p, retained3p, x, width).junctionX;
}

/**
 * Does a caller-provided site description explicitly indicate the partner
 * contributes promoter / 5′UTR only (no coding)? cBioPortal/TARGET SV records
 * carry forms like "5'-UTR of FRMD6(+):38Kb before coding start" and
 * "Promoter of GENE" — the caller's authoritative call, which geometry can't
 * always recover (e.g. when Genome Nexus omits UTR annotation). Checked before
 * geometry. A 3′UTR mention never matches.
 */
export function descriptionImpliesNoCoding(siteDescription?: string): boolean {
    if (!siteDescription) return false;
    const s = siteDescription.toLowerCase();
    if (/\bpromoter\b/.test(s)) return true;
    // "5'-UTR of ...", "5' utr", "five prime utr"
    if (/\b5\s*'?\s*-?\s*utr\b/.test(s)) return true;
    if (/\bfive[\s-]?prime[\s-]?utr\b/.test(s)) return true;
    return false;
}

/**
 * Promoter-swap heuristic: does the 5′ partner contribute promoter / 5′UTR only
 * (no coding)? True when either the caller's annotation says so, or the 5′
 * breakpoint is at/upstream of the 5′ gene's CDS start (so the fusion product's
 * ORF comes from the 3′ gene driven by the 5′ promoter). Geometry requires
 * 5′UTR annotation on the transcript; with neither signal it returns false
 * (can't tell → don't flag).
 */
export function fivePrimeContributesNoCoding(
    transcript5p: TranscriptData,
    breakpoint5p: number,
    siteDescription5p?: string
): boolean {
    // Primary signal: the caller's own annotation.
    if (descriptionImpliesNoCoding(siteDescription5p)) return true;
    // Fallback: geometry from Genome Nexus 5′UTR annotation.
    const fiveUtrs = (transcript5p.utrs || []).filter(
        u => u.type === 'five_prime'
    );
    if (fiveUtrs.length === 0) return false;
    if (transcript5p.strand === '+') {
        // CDS begins just after the last (highest-coord) 5′UTR base.
        const lastUtrEnd = Math.max(...fiveUtrs.map(u => u.end));
        return breakpoint5p <= lastUtrEnd;
    }
    // − strand: 5′UTR is the highest-coord region; CDS begins just below it.
    const firstUtrStart = Math.min(...fiveUtrs.map(u => u.start));
    return breakpoint5p >= firstUtrStart;
}

/**
 * Does the 3′ partner contribute coding sequence to the product? A real promoter
 * swap needs the 3′ gene to supply the ORF — if it doesn't, there is no chimeric
 * protein at all. Conservative by default (returns true so genuine swaps still
 * render); returns false only on positive evidence the 3′ side is non-coding:
 * a caller annotation naming its 3′UTR, or a breakpoint inside the 3′UTR.
 */
export function threePrimeContributesCoding(
    transcript3p: TranscriptData,
    breakpoint3p: number,
    siteDescription3p?: string
): boolean {
    if (
        siteDescription3p &&
        /\b3\s*'?\s*-?\s*utr\b/.test(siteDescription3p.toLowerCase())
    ) {
        return false;
    }
    const threeUtrs = (transcript3p.utrs || []).filter(
        u => u.type === 'three_prime'
    );
    if (threeUtrs.length === 0) return true; // no info → assume coding
    if (transcript3p.strand === '+') {
        // 3′UTR is the highest-coord region; CDS ends just before it. The 3′
        // partner retains [breakpoint, txEnd]; coding only if the break is below
        // the CDS end.
        const cdsEnd = Math.min(...threeUtrs.map(u => u.start));
        return breakpoint3p < cdsEnd;
    }
    // − strand: 3′UTR is the lowest-coord region; CDS ends just above it.
    const cdsEnd = Math.max(...threeUtrs.map(u => u.end));
    return breakpoint3p > cdsEnd;
}

/**
 * Composed promoter-swap decision: the 5′ partner contributes no coding AND, when
 * 3′ partner data is available, the 3′ partner does contribute coding. Use this
 * at render time rather than calling the parts directly.
 */
export function detectPromoterSwap(args: {
    transcript5p: TranscriptData;
    breakpoint5p: number;
    siteDescription5p?: string;
    transcript3p?: TranscriptData;
    breakpoint3p?: number;
    siteDescription3p?: string;
}): boolean {
    // Intragenic guard: an SV whose two breakpoints are in the SAME gene
    // (intragenic DEL/DUP/INV) is one gene rearranged internally, not a
    // promoter swap between two genes.
    if (
        args.transcript3p &&
        args.transcript5p.gene &&
        args.transcript5p.gene === args.transcript3p.gene
    ) {
        return false;
    }
    if (
        !fivePrimeContributesNoCoding(
            args.transcript5p,
            args.breakpoint5p,
            args.siteDescription5p
        )
    ) {
        return false;
    }
    if (args.transcript3p && args.breakpoint3p != null) {
        return threePrimeContributesCoding(
            args.transcript3p,
            args.breakpoint3p,
            args.siteDescription3p
        );
    }
    return true;
}
