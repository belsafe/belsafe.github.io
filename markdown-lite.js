(function () {
  "use strict";

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function safeHref(url) {
    const trimmed = String(url || "").trim();
    if (!trimmed) {
      return "#";
    }

    try {
      const parsed = new URL(trimmed, window.location.origin);
      const allowed = parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:";
      return allowed ? parsed.href : "#";
    } catch (_error) {
      return "#";
    }
  }

  function renderInline(line) {
    const escaped = escapeHtml(line);

    return escaped
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/_([^_]+)_/g, "<em>$1</em>")
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_all, alt, src) {
        if (typeof renderInline._imageResolver === "function") {
          const resolved = renderInline._imageResolver(src);
          if (resolved) {
            return '<img class="md-image" src="' + resolved + '" alt="' + alt + '" />';
          }
        }
        return '<span class="md-image-broken" title="' + escapeHtml(src) + '">[image: ' + escapeHtml(alt || src) + ']</span>';
      })
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_all, text, href) {
        const safe = safeHref(href);
        return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + text + "</a>";
      });
  }

  function render(markdown, options) {
    renderInline._imageResolver = (options && typeof options.imageResolver === "function")
      ? options.imageResolver
      : null;

    const text = String(markdown || "").replace(/\r\n?/g, "\n");
    const lines = text.split("\n");

    const out = [];
    let inCode = false;
    let codeLines = [];
    let inUl = false;
    let inOl = false;
    let inTable = false;
    let tableAlign = [];

    function closeLists() {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
    }

    function closeTable() {
      if (inTable) {
        out.push("</tbody></table>");
        inTable = false;
        tableAlign = [];
      }
    }

    function closeBlocks() {
      closeLists();
      closeTable();
    }

    function isTableSeparator(line) {
      const trimmed = line.trim();
      if (!trimmed.includes("|")) return false;
      const cells = trimmed.replace(/^\|/, "").replace(/\|\s*$/, "").split("|");
      return cells.length > 1 && cells.every(function (c) {
        return /^[:\s]*-{1,}[:\s]*$/.test(c.trim());
      });
    }

    function parseRowCells(line) {
      return line.trim().replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) { return c.trim(); });
    }

    function parseAlignment(sep) {
      return parseRowCells(sep).map(function (cell) {
        var left = cell.startsWith(":");
        var right = cell.endsWith(":");
        if (left && right) return "center";
        if (right) return "right";
        if (left) return "left";
        return "";
      });
    }

    function renderTableRow(cells, tag) {
      return "<tr>" + cells.map(function (cell, i) {
        var align = tableAlign[i] || "";
        var style = align ? ' style="text-align:' + align + '"' : "";
        return "<" + tag + style + ">" + renderInline(cell) + "</" + tag + ">";
      }).join("") + "</tr>";
    }

    for (var i = 0; i < lines.length; i++) {
      var rawLine = lines[i];
      var line = rawLine || "";

      if (line.startsWith("```")) {
        closeBlocks();
        if (!inCode) {
          codeLines = [];
          inCode = true;
        } else {
          out.push("<pre><code>" + codeLines.join("\n") + "</code></pre>");
          codeLines = [];
          inCode = false;
        }
        continue;
      }

      if (inCode) {
        codeLines.push(escapeHtml(line));
        continue;
      }

      if (/^\s*$/.test(line)) {
        closeBlocks();
        continue;
      }

      if (/^ {0,3}-{3,}\s*$/.test(line)) {
        closeBlocks();
        out.push("<hr>");
        continue;
      }

      if (line.includes("|")) {
        if (inTable) {
          if (isTableSeparator(line)) continue;
          out.push(renderTableRow(parseRowCells(line), "td"));
          continue;
        } else {
          var nextLine = lines[i + 1] || "";
          if (isTableSeparator(nextLine)) {
            inTable = true;
            tableAlign = parseAlignment(nextLine);
            out.push("<table><thead>");
            out.push(renderTableRow(parseRowCells(line), "th"));
            out.push("</thead><tbody>");
            i++;
            continue;
          }
        }
      }

      closeBlocks();

      var h = line.match(/^(#{1,6})\s+(.+)$/);
      if (h) {
        const level = h[1].length;
        out.push("<h" + level + ">" + renderInline(h[2]) + "</h" + level + ">");
        continue;
      }

      const ul = line.match(/^\s*[-*]\s+(.+)$/);
      if (ul) {
        if (inOl) {
          out.push("</ol>");
          inOl = false;
        }
        if (!inUl) {
          out.push("<ul>");
          inUl = true;
        }
        const task = ul[1].match(/^\[([ xX])\]\s+(.+)$/);
        if (task) {
          const checked = task[1].toLowerCase() === "x";
          out.push(
            "<li class=\"task-list-item\"><input class=\"task-list-checkbox\" type=\"checkbox\" disabled" +
              (checked ? " checked" : "") +
              " /><span>" +
              renderInline(task[2]) +
              "</span></li>"
          );
        } else {
          out.push("<li>" + renderInline(ul[1]) + "</li>");
        }
        continue;
      }

      const ol = line.match(/^\s*(\d+)\.\s+(.+)$/);
      if (ol) {
        if (inUl) {
          out.push("</ul>");
          inUl = false;
        }
        if (!inOl) {
          out.push("<ol>");
          inOl = true;
        }
        out.push("<li>" + renderInline(ol[2]) + "</li>");
        continue;
      }

      closeLists();
      out.push("<p>" + renderInline(line) + "</p>");
    }

    closeBlocks();
    if (inCode) {
      out.push("<pre><code>" + codeLines.join("\n") + "</code></pre>");
    }

    return out.join("\n");
  }

  window.MarkdownLite = {
    render: render,
  };
})();
