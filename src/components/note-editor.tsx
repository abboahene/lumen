import {
  autocompletion,
  closeBrackets,
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete"
import { history } from "@codemirror/commands"
import { EditorState } from "@codemirror/state"
import { EditorView, placeholder, ViewUpdate } from "@codemirror/view"
import { parseDate } from "chrono-node"
import { useSetAtom } from "jotai"
import { useAtomCallback } from "jotai/utils"
import React from "react"
import { tagsAtom, upsertNoteAtom } from "../global-atoms"
import { formatDate, formatDateDistance } from "../utils/date"
import { parseFrontmatter } from "../utils/parse-frontmatter"
import { useSearchNotes } from "../utils/use-search-notes"

type NoteEditorProps = {
  className?: string
  defaultValue?: string
  placeholder?: string
  editorRef?: React.MutableRefObject<EditorView | undefined>
  onStateChange?: (event: ViewUpdate) => void
  onPaste?: (event: ClipboardEvent, view: EditorView) => void
}

export function NoteEditor({
  className,
  defaultValue = "",
  placeholder = "Write a note…",
  editorRef,
  onStateChange,
  onPaste,
}: NoteEditorProps) {
  const { containerRef } = useCodeMirror({
    defaultValue,
    placeholder,
    editorRef,
    onStateChange,
    onPaste,
  })

  return <div ref={containerRef} className={className} />
}

// Reference: https://www.codiga.io/blog/implement-codemirror-6-in-react/
function useCodeMirror({
  defaultValue,
  placeholder: placeholderValue = "",
  editorRef: providedEditorRef,
  onStateChange,
  onPaste,
}: {
  defaultValue?: string
  placeholder?: string
  editorRef?: React.MutableRefObject<EditorView | undefined>
  onStateChange?: (event: ViewUpdate) => void
  onPaste?: (event: ClipboardEvent, view: EditorView) => void
}) {
  const [editorElement, setEditorElement] = React.useState<HTMLElement>()
  const containerRef = React.useCallback((node: HTMLElement | null) => {
    if (!node) return
    setEditorElement(node)
  }, [])
  const newEditorRef = React.useRef<EditorView>()
  const editorRef = providedEditorRef ?? newEditorRef

  // const [value, setValue] = React.useState(defaultValue)

  // Completions
  const noteCompletion = useNoteCompletion()
  const tagCompletion = useTagCompletion()

  React.useEffect(() => {
    if (!editorElement) return

    const state = EditorState.create({
      doc: defaultValue,
      extensions: [
        placeholder(placeholderValue),
        history(),
        EditorView.updateListener.of((event) => {
          // const value = event.view.state.doc.sliceString(0)
          // setValue(value)
          onStateChange?.(event)
        }),
        EditorView.domEventHandlers({
          paste: (event, view) => {
            const clipboardText = event.clipboardData?.getData("text/plain") ?? ""
            const isUrl = /^https?:\/\//.test(clipboardText)

            // If the clipboard text is a URL, convert selected text into a markdown link
            if (isUrl) {
              const { selection } = view.state
              const { from = 0, to = 0 } = selection.ranges[selection.mainIndex] ?? {}
              const selectedText = view?.state.doc.sliceString(from, to) ?? ""
              const markdown = selectedText ? `[${selectedText}](${clipboardText})` : clipboardText

              view.dispatch({
                changes: {
                  from,
                  to,
                  insert: markdown,
                },
                selection: {
                  anchor: from + markdown.length,
                },
              })

              event.preventDefault()
            }

            onPaste?.(event, view)
          },
        }),
        closeBrackets(),
        autocompletion({
          override: [dateCompletion, noteCompletion, tagCompletion],
          icons: false,
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: editorElement,
    })

    editorRef.current = view

    return () => {
      view.destroy()
    }
  }, [
    editorElement,
    // defaultValue,
    placeholderValue,
    onStateChange,
    onPaste,
    editorRef,
    // TODO: Prevent noteCompletion and tagCompletion from being recreated when state changes
    // noteCompletion,
    // tagCompletion,
  ])

  return { containerRef }
}

function dateCompletion(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/(\[\[[^\]|^|]*|\w*)/)

  if (!word) {
    return null
  }

  // "[[<query>" -> "<query>"
  const query = word.text.replace(/^\[\[/, "")

  if (!query) {
    return null
  }

  const date = parseDate(query)

  if (!date) {
    return null
  }

  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const dateString = `${year}-${month}-${day}`

  return {
    from: word.from,
    options: [
      {
        label: formatDate(dateString),
        detail: formatDateDistance(dateString),
        apply: (view, completion, from, to) => {
          const text = `[[${dateString}]]`

          const hasClosingBrackets = view.state.sliceDoc(to, to + 2) === "]]"
          view.dispatch({
            changes: { from, to: hasClosingBrackets ? to + 2 : to, insert: text },
            selection: { anchor: from + text.length },
          })
        },
      },
    ],
    filter: false,
  }
}

function useTagCompletion() {
  const getTags = useAtomCallback(React.useCallback((get) => get(tagsAtom), []))

  const tagCompletion = React.useCallback(
    async (context: CompletionContext): Promise<CompletionResult | null> => {
      const word = context.matchBefore(/#[\w\-_\d/]*/)

      if (!word) {
        return null
      }

      const tags = Object.keys(getTags())

      return {
        from: word.from + 1,
        options: tags.map((name) => ({ label: name })),
      }
    },
    [getTags],
  )

  return tagCompletion
}

function useNoteCompletion() {
  const upsertNote = useSetAtom(upsertNoteAtom)
  const searchNotes = useSearchNotes()

  const noteCompletion = React.useCallback(
    async (context: CompletionContext): Promise<CompletionResult | null> => {
      const word = context.matchBefore(/\[\[[^\]|^|]*/)

      if (!word) {
        return null
      }

      // "[[<query>" -> "<query>"
      const query = word.text.slice(2)

      const searchResults = searchNotes(query)

      const createNewNoteOption: Completion = {
        label: `Create new note "${query}"`,
        apply: (view, completion, from, to) => {
          const note = {
            id: Date.now().toString(),
            rawBody: `# ${query}\n\n#inbox`,
          }

          upsertNote(note)

          // Insert link to new note
          const text = `[[${note.id}|${query}]]`

          const hasClosingBrackets = view.state.sliceDoc(to, to + 2) === "]]"
          view.dispatch({
            changes: { from, to: hasClosingBrackets ? to + 2 : to, insert: text },
            selection: { anchor: from + text.length },
          })
        },
      }

      const options = searchResults.slice(0, 5).map(([id, note]): Completion => {
        const { content } = parseFrontmatter(note?.rawBody || "")
        return {
          label: content || "",
          info: content,
          apply: (view, completion, from, to) => {
            // Insert link to note
            const text = `[[${id}${note?.title ? `|${note.title}` : ""}]]`

            const hasClosingBrackets = view.state.sliceDoc(to, to + 2) === "]]"
            view.dispatch({
              changes: { from, to: hasClosingBrackets ? to + 2 : to, insert: text },
              selection: { anchor: from + text.length },
            })
          },
        }
      })

      if (query) {
        options.push(createNewNoteOption)
      }

      return {
        from: word.from,
        options,
        filter: false,
      }
    },
    [searchNotes, upsertNote],
  )

  return noteCompletion
}