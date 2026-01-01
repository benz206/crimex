"use client";

import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

export type CustomSelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

type SingleProps = {
  multiple?: false;
  value: string;
  onValue: (v: string) => void;
  options: CustomSelectOption[];
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
};

type MultiProps = {
  multiple: true;
  value: string[];
  onValue: (v: string[]) => void;
  options: CustomSelectOption[];
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
};

type Props = SingleProps | MultiProps;

export function CustomSelect({
  multiple,
  value,
  onValue,
  options,
  className,
  buttonClassName,
  menuClassName,
}: Props) {
  const id = useId();
  const listboxId = `${id}-listbox`;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(() => {
    const first = options.findIndex((o) => !o.disabled);
    const fallback = first >= 0 ? first : 0;
    if (multiple) return fallback;
    return Math.max(0, options.findIndex((o) => o.value === value));
  });

  const selectedLabel = useMemo(() => {
    if (multiple) {
      const vals = new Set(Array.isArray(value) ? value : []);
      const allOpt = options.find((o) => o.value === "");
      const picked = options.filter((o) => o.value !== "" && vals.has(o.value));
      if (picked.length === 0) return allOpt?.label ?? "";
      if (picked.length === 1) return picked[0]?.label ?? "";
      const labels = picked.map((p) => p.label);
      if (labels.every((x) => typeof x === "string")) return (labels as string[]).join(", ");
      return `${picked.length} selected`;
    }

    return options.find((o) => o.value === value)?.label ?? "";
  }, [multiple, options, value]);

  const firstEnabledIndex = useMemo(() => {
    const i = options.findIndex((o) => !o.disabled);
    return i >= 0 ? i : 0;
  }, [options]);

  const lastEnabledIndex = useMemo(() => {
    for (let i = options.length - 1; i >= 0; i--) {
      if (!options[i]?.disabled) return i;
    }
    return Math.max(0, options.length - 1);
  }, [options]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const el = wrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, { capture: true });
    return () =>
      window.removeEventListener("pointerdown", onDown, { capture: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      optionRefs.current[activeIndex]?.focus();
      optionRefs.current[activeIndex]?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }, 0);
    return () => clearTimeout(t);
  }, [open, activeIndex]);

  const syncActiveToValue = () => {
    if (multiple) {
      setActiveIndex(firstEnabledIndex);
      return;
    }
    const i = options.findIndex((o) => o.value === value);
    setActiveIndex(i >= 0 ? i : firstEnabledIndex);
  };

  const openMenu = () => {
    syncActiveToValue();
    setOpen(true);
  };

  const move = (dir: 1 | -1) => {
    if (options.length === 0) return;
    let i = activeIndex;
    for (let step = 0; step < options.length; step++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i]?.disabled) {
        setActiveIndex(i);
        return;
      }
    }
  };

  const commit = (i: number) => {
    const opt = options[i];
    if (!opt || opt.disabled) return;

    if (multiple) {
      const current = Array.isArray(value) ? value : [];
      if (opt.value === "") {
        onValue([]);
        return;
      }
      const next = current.includes(opt.value)
        ? current.filter((x) => x !== opt.value)
        : [...current, opt.value];
      onValue(next);
      return;
    }

    onValue(opt.value);
    setOpen(false);
    btnRef.current?.focus();
  };

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <button
        ref={btnRef}
        type="button"
        className={`ui-cselect ${buttonClassName ?? ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openMenu();
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            openMenu();
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {selectedLabel}
        </span>
        <span aria-hidden className="ui-cselect__chev">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <path
              d="M5.7 7.6a1 1 0 0 1 1.4 0L10 10.5l2.9-2.9a1 1 0 1 1 1.4 1.4l-3.6 3.6a1 1 0 0 1-1.4 0L5.7 9a1 1 0 0 1 0-1.4Z"
              fill="currentColor"
            />
          </svg>
        </span>
      </button>

      {open && (
        <div
          className={`ui-panel-strong ui-cselect-menu ${menuClassName ?? ""}`}
          role="listbox"
          id={listboxId}
          aria-activedescendant={`${id}-opt-${activeIndex}`}
          aria-multiselectable={multiple ? true : undefined}
        >
          {options.map((o, i) => {
            const isSelected = multiple
              ? (Array.isArray(value) && value.includes(o.value)) ||
                (o.value === "" && Array.isArray(value) && value.length === 0)
              : o.value === value;
            const isActive = i === activeIndex;
            return (
              <button
                key={`${o.value}-${i}`}
                ref={(el) => {
                  optionRefs.current[i] = el;
                }}
                id={`${id}-opt-${i}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={Boolean(o.disabled)}
                className={[
                  "ui-cselect-option",
                  isActive ? "ui-cselect-option--active" : "",
                  isSelected ? "ui-cselect-option--selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseEnter={() => setActiveIndex(i)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setOpen(false);
                    btnRef.current?.focus();
                    return;
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    move(1);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    move(-1);
                    return;
                  }
                  if (e.key === "Home") {
                    e.preventDefault();
                    setActiveIndex(firstEnabledIndex);
                    return;
                  }
                  if (e.key === "End") {
                    e.preventDefault();
                    setActiveIndex(lastEnabledIndex);
                    return;
                  }
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    commit(i);
                    if (!multiple) return;
                  }
                }}
                onClick={() => {
                  commit(i);
                  if (!multiple) return;
                }}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {isSelected && (
                  <span aria-hidden className="ui-cselect-option__check">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <path
                        d="M16.7 5.6a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 10a1 1 0 1 1 1.4-1.4l3.4 3.4 6.8-6.8a1 1 0 0 1 1.4 0Z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
