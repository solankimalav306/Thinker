    (function() {
      /**
       * Parse Markdown into a markmap node tree.
       * Strategy:
       *   - '# Header' lines set header nodes at depth (hashes - 1)
       *   - '- list' lines at absolute indent level: depth = lastHeaderDepth + 1 + floor(indent/2)
       *   - Stack is used to find the correct parent by comparing absolute depths
       */
      function parseMarkdown(md) {
        var lines = md.split('\n');
        // Sentinel root so we always have a parent
        var sentinel = { content: '', children: [], depth: -1 };
        var stack = [sentinel];
        var lastHeaderDepth = 0;

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line.trim()) continue;

          var hm = line.match(/^(#{1,6})\s+(.+)/);
          var lm = line.match(/^(\s*)[-*+]\s+(.+)/);

          if (hm) {
            var nodeDepth = hm[1].length - 1; // 0-indexed: # → 0, ## → 1
            var nodeContent = hm[2].trim();
            lastHeaderDepth = nodeDepth;
            var node = { content: nodeContent, children: [], depth: nodeDepth };
            // Pop until stack top has smaller depth
            while (stack.length > 1 && stack[stack.length - 1].depth >= nodeDepth) {
              stack.pop();
            }
            stack[stack.length - 1].children.push(node);
            stack.push(node);

          } else if (lm) {
            var indentLen = lm[1].length;
            var nodeContent = lm[2].trim();
            // Absolute depth: relative to the last header, not the stack top
            var nodeDepth = lastHeaderDepth + 1 + Math.floor(indentLen / 2);
            var node = { content: nodeContent, children: [], depth: nodeDepth };
            // Pop until stack top has smaller depth than this node
            while (stack.length > 1 && stack[stack.length - 1].depth >= nodeDepth) {
              stack.pop();
            }
            stack[stack.length - 1].children.push(node);
            stack.push(node);
          }
        }
        return sentinel;
      }

      function MinimalTransformer() {}
      MinimalTransformer.prototype.transform = function(md) {
        var sentinel = parseMarkdown(md);
        // Unwrap sentinel: if there's one child (the # root), promote it
        var root = sentinel.children.length === 1 ? sentinel.children[0] : sentinel;
        return { root: root };
      };

      window.markmap = window.markmap || {};
      window.markmap.Transformer = MinimalTransformer;
      console.debug('MinimalTransformer registered on window.markmap');
    })();
