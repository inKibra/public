type FaviconLinksProps = {
  faviconIco: string;
  favicon16: string;
  favicon32: string;
  appleTouchIcon: string;
  androidChrome192: string;
  androidChrome512: string;
};

export function FaviconLinks(props: FaviconLinksProps) {
  return (
    <>
      <link
        rel="apple-touch-icon"
        sizes="180x180"
        href={props.appleTouchIcon}
      />
      <link rel="icon" type="image/png" sizes="32x32" href={props.favicon32} />
      <link rel="icon" type="image/png" sizes="16x16" href={props.favicon16} />
      <link
        rel="icon"
        type="image/png"
        sizes="192x192"
        href={props.androidChrome192}
      />
      <link
        rel="icon"
        type="image/png"
        sizes="512x512"
        href={props.androidChrome512}
      />
      <link rel="shortcut icon" href={props.faviconIco} />
    </>
  );
}
