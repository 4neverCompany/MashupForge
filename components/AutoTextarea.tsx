'use client';

/**
 * Auto-sizing textarea that grows with its content. Resets to
 * scrollHeight on every render so deletions shrink it too. Shared by
 * Captioning Studio and Post Ready tabs so long captions don't get
 * clipped behind a fixed row count.
 */
import React from 'react';

interface AutoTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  minRows?: number;
}

function AutoTextareaInner(
  { minRows = 2, className, value, ...rest }: AutoTextareaProps,
  ref: React.Ref<HTMLTextAreaElement>,
) {
  React.useLayoutEffect(() => {
    const el = (ref as React.RefObject<HTMLTextAreaElement>).current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, ref]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      className={`resize-none overflow-hidden ${className || ''}`}
      {...rest}
    />
  );
}

export const AutoTextarea = React.forwardRef<HTMLTextAreaElement, AutoTextareaProps>(
  AutoTextareaInner,
);
AutoTextarea.displayName = 'AutoTextarea';
