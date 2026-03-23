'use client';

interface Person {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface PeopleAvatarsProps {
  people: Person[];
  max?: number;
  size?: number;
  showLabel?: boolean;
}

export default function PeopleAvatars({ people, max = 4, size = 24, showLabel = true }: PeopleAvatarsProps) {
  if (people.length === 0) return null;

  const visible = people.slice(0, max);
  const overflow = people.length - max;
  const fontSize = size <= 24 ? 9 : 10;
  const borderWidth = size <= 24 ? 1.5 : 2;

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center">
        {visible.map((person, i) => {
          const letter = (person.display_name ?? person.id).charAt(0).toUpperCase();
          return (
            <div
              key={person.id}
              className="relative flex items-center justify-center rounded-full font-semibold cursor-default"
              style={{
                width: size,
                height: size,
                marginLeft: i === 0 ? 0 : -8,
                backgroundColor: person.avatar_url ? 'transparent' : '#58a6ff',
                border: `${borderWidth}px solid #1c2028`,
                color: '#0f1117',
                fontSize,
                zIndex: max - i,
                backgroundImage: person.avatar_url ? `url(${person.avatar_url})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
              title={person.display_name ?? 'User'}
            >
              {!person.avatar_url && letter}
            </div>
          );
        })}
      </div>
      {showLabel && (
        <span className="text-[11px]" style={{ color: '#8b949e' }}>
          {overflow > 0
            ? `+${overflow} would live here`
            : people.length === 1
              ? '1 would live here'
              : `${people.length} would live here`}
        </span>
      )}
    </div>
  );
}
