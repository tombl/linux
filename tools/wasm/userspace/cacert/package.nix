# Mozilla CA bundle for guest TLS (curl / openssl).
{
  pkgs,
  stdenv,
}:

stdenv.mkDerivation {
  pname = "cacert";
  # apk rejects dashed date versions; keep a simple numeric epoch.
  version = "20260301";

  # Use nixpkgs' already-fetched bundle; install into the FHS path curl expects.
  src = pkgs.cacert;

  dontUnpack = true;
  dontConfigure = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall
    mkdir -p $out/etc/ssl/certs
    cp ${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt $out/etc/ssl/certs/ca-bundle.crt
    ln -s ca-bundle.crt $out/etc/ssl/certs/ca-certificates.crt
    # BusyBox wget / openssl default locations.
    mkdir -p $out/etc/ssl
    ln -sf certs/ca-bundle.crt $out/etc/ssl/cert.pem
    runHook postInstall
  '';
}
