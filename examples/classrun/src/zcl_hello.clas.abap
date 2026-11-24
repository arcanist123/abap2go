CLASS zcl_hello DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_hello IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    out->write( 'Hello, World!' ).
    out->write( data = `from a class` name = 'source' ).
  ENDMETHOD.
ENDCLASS.
