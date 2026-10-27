import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cleanMarkdown } from "../utils/aiFormatters";

function CodeBlock({ children, className = "" }) {
  const [copied, setCopied] = useState(false);
  const codeString = String(children).replace(/\n$/, "");

  const match = /language-(\w+)/.exec(className || "");
  const lang = match ? match[1] : "";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(codeString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  }

  return (
    <div className="md-code-wrapper">
      <div className="md-code-header">
        <span className="md-code-lang">{lang || "code"}</span>
        <button
          type="button"
          className="md-code-copy-btn"
          onClick={handleCopy}
          title="Copy code"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre className="md-code-block">
        <code className={`md-code-text ${className}`}>{children}</code>
      </pre>
    </div>
  );
}

export default function MarkdownRenderer({ content, className = "" }) {
  if (!content) return null;

  const processedContent = cleanMarkdown(content);

  return (
    <div className={`markdown-body-container ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children, ...props }) => (
            <h1 className="md-h1" {...props}>
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 className="md-h2" {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="md-h3" {...props}>
              {children}
            </h3>
          ),
          h4: ({ children, ...props }) => (
            <h4 className="md-h4" {...props}>
              {children}
            </h4>
          ),
          p: ({ children, ...props }) => (
            <p className="md-p" {...props}>
              {children}
            </p>
          ),
          ul: ({ children, ...props }) => (
            <ul className="md-ul" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="md-ol" {...props}>
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li className="md-li" {...props}>
              {children}
            </li>
          ),
          table: ({ children, ...props }) => (
            <div className="md-table-wrapper">
              <table className="md-table" {...props}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children, ...props }) => (
            <thead className="md-thead" {...props}>
              {children}
            </thead>
          ),
          tbody: ({ children, ...props }) => (
            <tbody className="md-tbody" {...props}>
              {children}
            </tbody>
          ),
          tr: ({ children, ...props }) => (
            <tr className="md-tr" {...props}>
              {children}
            </tr>
          ),
          th: ({ children, ...props }) => (
            <th className="md-th" {...props}>
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="md-td" {...props}>
              {children}
            </td>
          ),
          blockquote: ({ children, ...props }) => (
            <blockquote className="md-blockquote" {...props}>
              {children}
            </blockquote>
          ),
          hr: (props) => <hr className="md-hr" {...props} />,
          a: ({ children, href, ...props }) => (
            <a
              className="md-link"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            >
              {children}
            </a>
          ),
          strong: ({ children, ...props }) => {
            const textContent = String(children);
            const isCorrectAnswer = /correct answer/i.test(textContent);
            const isDifficulty = /difficulty/i.test(textContent);
            const isEasy = /easy/i.test(textContent);
            const isMedium = /medium/i.test(textContent);
            const isHard = /hard/i.test(textContent);
            const isStudyTip = /study tip/i.test(textContent);

            let extraClass = "";
            if (isCorrectAnswer) extraClass = "md-correct-tag";
            else if (isDifficulty) {
              if (isEasy) extraClass = "md-diff-easy";
              else if (isMedium) extraClass = "md-diff-medium";
              else if (isHard) extraClass = "md-diff-hard";
              else extraClass = "md-difficulty-tag";
            } else if (isStudyTip) extraClass = "md-tip-tag";

            return (
              <strong className={`md-strong ${extraClass}`} {...props}>
                {children}
              </strong>
            );
          },
          code: ({ inline, className: codeClassName, children, ...props }) => {
            if (inline) {
              return (
                <code className="md-inline-code" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <CodeBlock className={codeClassName} {...props}>
                {children}
              </CodeBlock>
            );
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
