export function ErrorList({ errors, title }: { errors: string[]; title?: string }) {
  if (!errors.length) return null;
  return (
    <div className="alert alert-error" role="alert">
      {title && <strong>{title}</strong>}
      <ul>
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </div>
  );
}
