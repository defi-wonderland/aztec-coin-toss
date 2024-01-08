use dep::aztec::types::type_serialization::TypeSerializationInterface;
use dep::std::ec::tecurve::affine::Point as Gaffine;

fn serialize_gaffine(value: Gaffine) -> [Field; GAFFINE_SERIALIZED_LEN] {
    let mut serialized = [0; GAFFINE_SERIALIZED_LEN];
    serialized[0] = value.x;
    serialized[1] = value.y;
    serialized
}

fn deserialize_gaffine(serialized: [Field; GAFFINE_SERIALIZED_LEN]) -> Gaffine {
    Gaffine{x: serialized[0], y: serialized[1]}
}

global GAFFINE_SERIALIZED_LEN = 2;

global GaffineSerializationMethods = TypeSerializationInterface {
    deserialize: deserialize_gaffine,
    serialize: serialize_gaffine,
};