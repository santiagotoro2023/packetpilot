# PacketPilot: additions to the installer (blueprint core in installer/core/).
# This file is pasted into packetpilot-install.sh between the core's options and its actions.

# Installers before 3.0.0 (before the blueprint) read the version of the new script from
# this line when they run --update. Keep it, so every old server can still update.
PP_VERSION="@@VERSION@@"
