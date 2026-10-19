import { cn } from "@/lib/cn";
import { initials } from "@/components/shell";
import { useAvatarSrc } from "@/lib/arena3/avatar";

export type UserAvatarProps = {
  name?: string | null;
  url?: string | null;
  className?: string;
  initialsClassName?: string;
  alt?: string;
};

/**
 * Renders an authenticated user avatar image via blob URL or falls back to initials.
 */
export function UserAvatar({
  name,
  url,
  className,
  initialsClassName,
  alt,
}: UserAvatarProps) {
  const src = useAvatarSrc(url);

  return (
    <span
      className={cn(
        "relative inline-grid size-full place-items-center overflow-hidden rounded-full select-none",
        !src && "bg-wood",
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt={alt ?? name ?? "Avatar"}
          className="size-full rounded-full object-cover transition-opacity duration-200 motion-reduce:transition-none"
          decoding="async"
        />
      ) : (
        <span className={cn("grid size-full place-items-center font-display", initialsClassName)}>
          {initials(name ?? undefined)}
        </span>
      )}
    </span>
  );
}
