"""Use the schema library of the installed Home Assistant generation."""
try:
    import probatio as vol
except ImportError:
    import voluptuous as vol
