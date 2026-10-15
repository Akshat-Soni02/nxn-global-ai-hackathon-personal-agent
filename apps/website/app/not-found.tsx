// A page that isn't here: say so, and point home.
import { Band, More, Orb } from "../components/ui";

export default function NotFound() {
  return (
    <Band tone="night" className="hero page-hero" label="Not found">
      <div className="wrap">
        <Orb />
        <h1 className="headline">This page isn't here.</h1>
        <p className="lead">It may have moved. Everything about Shadow starts on the overview.</p>
        <div className="actions" style={{ marginTop: 28 }}>
          <More href="/">Go to the overview</More>
        </div>
      </div>
    </Band>
  );
}
