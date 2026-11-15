# Offline communications operating plan

## GHOSTLINK limitations

The radio bridge uses an optional Meshtastic-compatible device. A connected serial interface is not evidence that packets reached another node. A radio write receipt and an actual recipient acknowledgement are different things. The first release deliberately labels writes to a radio as unconfirmed.

## Test before an outage

Use two compatible physical radios with approved frequencies, known-good antennas and charged batteries. Test a short message in both directions at the intended locations. Record successful reception, loss of signal, terrain changes and realistic battery endurance. Retest after antenna, firmware, channel or mounting changes.

## Australia configuration

Meshtastic documents the **ANZ** regional setting for Australian 915–928 MHz operation. Verify that the particular radio and antenna are suitable and that current local legal requirements are met. Do not transmit on an arbitrary frequency, especially with unmatched antennas.

## Write messages for constrained links

Use short, factual messages with time and location. State whether a request requires a reply. Avoid relying on encrypted communications unless keys and channel settings have actually been verified. Keep a paper communications schedule and backup receiver.

## Emergency contacts

Mesh networks do not provide emergency-call coverage by default. Try 000 in Australia if ordinary phone service is available, and follow advice from emergency authorities.
