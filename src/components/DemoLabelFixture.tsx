import { demoLabelFixtureContent } from '../features/demo/cases';
import type { DemoFixtureVariant } from '../features/extraction/types';

export function DemoLabelFixture({ variant }: { variant: DemoFixtureVariant }) {
  const fixture = demoLabelFixtureContent[variant];

  return (
    <figure className="demo-label-fixture" aria-label="Illustrative label fixture">
      <p className="demo-label-fixture__brand">{fixture.brandName}</p>
      <p>{fixture.classType}</p>
      {fixture.abv ? <p>{fixture.abv}</p> : null}
      <p>{fixture.netContents}</p>
      <p>{fixture.producerAddress}</p>
      {fixture.countryOfOrigin ? <p>{fixture.countryOfOrigin}</p> : null}
      <p>
        {fixture.warningHeadingBold ? (
          <strong>{fixture.warningHeading}</strong>
        ) : (
          <span>{fixture.warningHeading}</span>
        )}{' '}
        {fixture.warningBody}
      </p>
    </figure>
  );
}
