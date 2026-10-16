import JSZip from 'jszip';

/**
 * Минимальный генератор .xlsx с нативными графиками Excel.
 *
 * Почему свой, а не библиотека: проверены excel4node 1.8.2 и SheetJS —
 * ни одна из них не умеет создавать графики (в excel4node метода addChart
 * просто нет в исходниках). Нативные графики — это отдельные части пакета
 * OOXML (xl/charts/chartN.xml), и их нужно собрать руками.
 *
 * Используются inline-строки (t="inlineStr") вместо общей таблицы строк —
 * это сокращает число частей пакета и убирает риск рассогласования индексов.
 *
 * Порядок элементов внутри XML задан схемой OOXML и не произвольный: Excel
 * отказывается открывать файл, если он нарушен.
 */

export interface CellValue {
  value: string | number | null;
  /** Жирный текст */
  bold?: boolean;
  /** Заливка ячейки цветом #RRGGBB */
  fill?: string;
  /** Формат числа, например '#,##0.00" ₸"' */
  numFmt?: string;
}

export type Cell = CellValue | string | number | null;

export interface ChartPoint {
  label: string;
  value: number;
  color: string;
}

export interface BarSeries {
  name: string;
  color: string;
  points: { label: string; value: number }[];
}

export interface ChartSpec {
  type: 'doughnut' | 'pie' | 'bar';
  title: string;
  /** Для кольцевых и круговых — подписи и цвета секторов */
  points: ChartPoint[];
  /** Для столбчатой — один или два ряда */
  series?: BarSeries[];
  anchor: { fromCol: number; fromRow: number; toCol: number; toRow: number };
}

export interface SheetSpec {
  name: string;
  columns?: { width: number }[];
  rows: Cell[][];
  charts?: ChartSpec[];
  merges?: { fromCol: number; fromRow: number; toCol: number; toRow: number }[];
}

/** A1-адрес столбца: 1 → A, 27 → AA */
export function colName(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Управляющие символы XML запрещены даже внутри текста
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** '#RRGGBB' → 'RRGGBB' для a:srgbClr. Мусорные значения заменяем на серый. */
function hex(c: string | undefined | null): string {
  if (!c) return '808080';
  const v = c.trim().replace('#', '');
  return /^[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : '808080';
}

function normalize(cell: Cell): CellValue {
  if (cell === null || cell === undefined) return { value: null };
  if (typeof cell === 'object') return cell;
  return { value: cell };
}

/**
 * Индексы стилей в cellXfs. 0 — обычный текст, 1 — жирный; дальше по мере
 * появления новых комбинаций. Каждой комбинации соответствует свой xf, и
 * сами стили переиспользуются через кэш, поэтому файл не растёт.
 */
class StyleRegistry {
  private readonly entries: { numFmtId?: number; bold: boolean; fill?: string }[] = [];
  private readonly customNumFmts: string[] = [];
  private readonly cache = new Map<string, number>();

  get(cell: CellValue): number {
    const key = `${cell.bold ? 1 : 0}|${cell.fill ?? ''}|${cell.numFmt ?? ''}`;
    const found = this.cache.get(key);
    if (found !== undefined) return found;

    let numFmtId: number | undefined;
    if (cell.numFmt) {
      numFmtId = 164 + this.customNumFmts.length;
      this.customNumFmts.push(cell.numFmt);
    }

    const xf = this.entries.length;
    this.entries.push({ numFmtId, bold: !!cell.bold, fill: cell.fill });
    this.cache.set(key, xf);
    return xf;
  }

  stylesXml(): string {
    const numFmts = this.customNumFmts
      .map((code, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(code)}"/>`)
      .join('');

    // Заливки: индексы 0 и 1 обязательны (none и gray125), всё что дальше —
    // реальные цвета. Список строится по всем встреченным цветам.
    const fills = [...new Set(this.entries.map((e) => e.fill).filter(Boolean))] as string[];

    const xfs = this.entries
      .map((e) => {
        const fillId = e.fill ? 2 + fills.indexOf(e.fill) : 0;
        const fontId = e.bold ? 1 : 0;
        const attrs = [
          `numFmtId="${e.numFmtId ?? 0}"`,
          `fontId="${fontId}"`,
          `fillId="${fillId}"`,
          'borderId="0"',
          'xfId="0"',
          'applyFont="1"',
          e.fill ? 'applyFill="1"' : '',
          e.numFmtId ? 'applyNumberFormat="1"' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `<xf ${attrs} applyAlignment="1"><alignment vertical="center"/></xf>`;
      })
      .join('');

    const fillsXml = fills
      .map(
        (c) =>
          `<fill><patternFill patternType="solid"><fgColor rgb="FF${hex(
            c
          )}"/><bgColor indexed="64"/></patternFill></fill>`
      )
      .join('');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
${numFmts ? `<numFmts count="${this.customNumFmts.length}">${numFmts}</numFmts>` : ''}
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="${2 + fills.length}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fillsXml}</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${this.entries.length}">${xfs}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  }
}

function sheetXml(sheet: SheetSpec, styles: StyleRegistry, drawingRid: string | null): string {
  const cols = sheet.columns?.length
    ? `<cols>${sheet.columns
        .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  const rows = sheet.rows
    .map((row, rIdx) => {
      const cells = row
        .map((raw, cIdx) => {
          const cell = normalize(raw);
          if (cell.value === null || cell.value === '') return '';
          const ref = `${colName(cIdx + 1)}${rIdx + 1}`;
          const styled = cell.bold || cell.fill || cell.numFmt;
          const s = styled ? ` s="${styles.get(cell)}"` : '';
          if (typeof cell.value === 'number') {
            if (!Number.isFinite(cell.value)) return '';
            return `<c r="${ref}"${s}><v>${cell.value}</v></c>`;
          }
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(
            cell.value
          )}</t></is></c>`;
        })
        .join('');
      return cells ? `<row r="${rIdx + 1}">${cells}</row>` : '';
    })
    .join('');

  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges
        .map(
          (m) =>
            `<mergeCell ref="${colName(m.fromCol)}${m.fromRow}:${colName(m.toCol)}${m.toRow}"/>`
        )
        .join('')}</mergeCells>`
    : '';

  // Внутри листа порядок задан схемой: cols → sheetData → mergeCells → drawing
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${cols}<sheetData>${rows}</sheetData>${merges}${drawingRid ? `<drawing r:id="${drawingRid}"/>` : ''}
</worksheet>`;
}

function strRef(ref: string, values: string[]): string {
  return `<c:strRef><c:f>${ref}</c:f><c:strCache><c:ptCount val="${values.length}"/>${values
    .map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`)
    .join('')}</c:strCache></c:strRef>`;
}

function numRef(ref: string, values: number[]): string {
  return `<c:numRef><c:f>${ref}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values
    .map((v, i) => `<c:pt idx="${i}"><c:v>${Number.isFinite(v) ? v : 0}</c:v></c:pt>`)
    .join('')}</c:numCache></c:numRef>`;
}

function chartTitleXml(title: string): string {
  return (
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p>` +
    `<a:pPr><a:defRPr sz="1200" b="1"/></a:pPr>` +
    `<a:r><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx>` +
    `<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
  );
}

function chartXml(chart: ChartSpec, sheetName: string, baseRow: number): string {
  const sheetRef = `'${sheetName.replace(/'/g, "''")}'`;
  const first = baseRow + 1;
  const title = chartTitleXml(chart.title);

  let plot: string;

  if (chart.type === 'bar' && chart.series && chart.series.length) {
    const labels = chart.series[0].points.map((p) => p.label);
    const last = baseRow + labels.length;

    const sers = chart.series
      .map((s, i) => {
        const col = colName(i + 2); // первый ряд — B, второй — C
        const values = s.points.map((p) => p.value);
        // Порядок внутри c:ser задан схемой: idx, order, tx, spPr, invertIfNegative, cat, val
        return (
          `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>` +
          `<c:tx>${strRef(`${sheetRef}!$${col}$${baseRow}`, [s.name])}</c:tx>` +
          `<c:spPr><a:solidFill><a:srgbClr val="${hex(s.color)}"/></a:solidFill></c:spPr>` +
          `<c:invertIfNegative val="0"/>` +
          `<c:cat>${strRef(`${sheetRef}!$A$${first}:$A$${last}`, labels)}</c:cat>` +
          `<c:val>${numRef(`${sheetRef}!$${col}$${first}:$${col}$${last}`, values)}</c:val>` +
          `</c:ser>`
        );
      })
      .join('');

    plot =
      `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>` +
      sers +
      `<c:gapWidth val="60"/><c:overlap val="-10"/><c:axId val="111111111"/><c:axId val="222222222"/></c:barChart>` +
      `<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
      `<c:delete val="0"/><c:axPos val="b"/><c:crossAx val="222222222"/></c:catAx>` +
      `<c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
      `<c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/>` +
      `<c:numFmt formatCode="#,##0" sourceLinked="0"/><c:crossAx val="111111111"/></c:valAx>`;
  } else {
    const last = baseRow + chart.points.length;
    const cat = `<c:cat>${strRef(
      `${sheetRef}!$A$${first}:$A$${last}`,
      chart.points.map((p) => p.label)
    )}</c:cat>`;
    const val = `<c:val>${numRef(
      `${sheetRef}!$B$${first}:$B$${last}`,
      chart.points.map((p) => p.value)
    )}</c:val>`;

    // Цвет каждого сектора задаём явно через c:dPt — иначе Excel раскрашивает
    // кольцо своей палитрой и выбранные в приложении цвета теряются.
    const dPts = chart.points
      .map(
        (p, i) =>
          `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr>` +
          `<a:solidFill><a:srgbClr val="${hex(p.color)}"/></a:solidFill>` +
          `<a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln>` +
          `</c:spPr></c:dPt>`
      )
      .join('');

    const tag = chart.type === 'pie' ? 'pieChart' : 'doughnutChart';
    const hole = chart.type === 'pie' ? '' : '<c:holeSize val="50"/>';

    plot =
      `<c:${tag}><c:varyColors val="1"/>` +
      // Порядок внутри c:ser задан схемой CT_PieSer:
      // idx, order, tx, spPr, explosion, dPt, dLbls, cat, val
      `<c:ser><c:idx val="0"/><c:order val="0"/>` +
      `<c:tx>${strRef(`${sheetRef}!$B$${baseRow}`, ['Сумма'])}</c:tx>` +
      dPts +
      `<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/>` +
      `<c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/></c:dLbls>` +
      cat +
      val +
      `</c:ser>` +
      `<c:firstSliceAng val="0"/>${hole}</c:${tag}>`;
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart>${title}<c:plotArea><c:layout/>${plot}</c:plotArea><c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}

function drawingXml(charts: ChartSpec[]): string {
  const anchors = charts
    .map((c, i) => {
      const { fromCol, fromRow, toCol, toRow } = c.anchor;
      return (
        `<xdr:twoCellAnchor editAs="oneCell">` +
        `<xdr:from><xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff>` +
        `<xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:to><xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff>` +
        `<xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr>` +
        `<xdr:cNvPr id="${i + 2}" name="Диаграмма ${i + 1}"/><xdr:cNvGraphicFramePr/>` +
        `</xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
        `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
        `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${i + 1}"/>` +
        `</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
      );
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`;
}

function contentTypesXml(sheets: SheetSpec[], chartCount: number): string {
  const overrides = [
    // Без объявления workbook.xml Excel считает файл повреждённым и
    // сообщает «Формат или расширение файла недопустимы».
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    ...sheets.map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ),
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    chartCount > 0
      ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
      : '',
    ...Array.from(
      { length: chartCount },
      (_, i) =>
        `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`
    ),
  ]
    .filter(Boolean)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`;
}

/** Первая запись архива; перезаписывается в конце, когда известно число графиков */
function placeholderContentTypes(sheets: SheetSpec[]): string {
  return contentTypesXml(sheets, 0);
}

/** Подписи категорий для блока данных на листе */
function chartLabels(chart: ChartSpec): string[] {
  if (chart.type === 'bar' && chart.series?.length) return chart.series[0].points.map((p) => p.label);
  return chart.points.map((p) => p.label);
}

/** Колонки блока данных: имя ряда и его значения, по одной на ряд графика */
function chartColumns(chart: ChartSpec): { name: string; values: number[] }[] {
  if (chart.type === 'bar' && chart.series?.length) {
    return chart.series.map((s) => ({ name: s.name, values: s.points.map((p) => p.value) }));
  }
  return [{ name: 'Сумма', values: chart.points.map((p) => p.value) }];
}

export async function buildXlsx(sheets: SheetSpec[]): Promise<Buffer> {
  const zip = new JSZip();
  const styles = new StyleRegistry();

  const rendered: { xml: string; charts: ChartSpec[]; baseRow: number }[] = [];
  const allCharts: { spec: ChartSpec; baseRow: number; sheetName: string }[] = [];

  // [Content_Types].xml обязан идти первой записью архива — иначе Excel
  // отвергает файл с «Формат или расширение файла недопустимы».
  zip.file('[Content_Types].xml', placeholderContentTypes(sheets));

  for (const sheet of sheets) {
    const charts = sheet.charts ?? [];
    const rows = [...sheet.rows];

    // Каждому графику — свой блок данных под таблицей. Общий блок не годится:
    // формулы рядов ссылаются на столбцы A/B/C, и столбчатый диаграмма тогда
    // читала бы значения соседнего кольцевого. Excel строит график по этим
    // ячейкам, поэтому данные должны быть на листе, а не только в кэше.
    const perChart: { spec: ChartSpec; baseRow: number }[] = [];

    for (const chart of charts) {
      const baseRow = rows.length + 2;
      const labels = chartLabels(chart);
      const columns = chartColumns(chart);

      rows.push([]);
      rows.push([
        { value: 'Категория', bold: true },
        ...columns.map((c) => ({ value: c.name, bold: true })),
      ]);
      for (let i = 0; i < labels.length; i++) {
        rows.push([labels[i], ...columns.map((c) => c.values[i] ?? 0)]);
      }
      perChart.push({ spec: chart, baseRow });
    }

    rendered.push({
      xml: sheetXml({ ...sheet, rows }, styles, charts.length ? 'rId1' : null),
      charts,
      baseRow: perChart[0]?.baseRow ?? 0,
    });
    for (const c of perChart) {
      allCharts.push({ spec: c.spec, baseRow: c.baseRow, sheetName: sheet.name });
    }
  }

  rendered.forEach(({ xml }, i) => {
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, xml);
    if (allCharts.length) {
      zip.file(
        `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`
      );
    }
  });

  if (allCharts.length) {
    allCharts.forEach((c, i) => {
      zip.file(`xl/charts/chart${i + 1}.xml`, chartXml(c.spec, c.sheetName, c.baseRow));
    });

    zip.file('xl/drawings/drawing1.xml', drawingXml(allCharts.map((c) => c.spec)));
    zip.file(
      'xl/drawings/_rels/drawing1.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${allCharts
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${i + 1}.xml"/>`
        )
        .join('')}</Relationships>`
    );
  }

  zip.file('xl/styles.xml', styles.stylesXml());

  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map(
        (s, i) => `<sheet name="${esc(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
      )
      .join('')}</sheets></workbook>`
  );

  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
      )
      .join('')}<Relationship Id="rId${
      sheets.length + 1
    }" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  );

  // Перезаписываем первую запись архива актуальным числом графиков
  zip.file('[Content_Types].xml', contentTypesXml(sheets, allCharts.length));

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}